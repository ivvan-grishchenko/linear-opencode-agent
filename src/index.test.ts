import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env, CodingTaskMessage } from './types';

import worker from './index';
import { handleOAuthAuthorize, handleOAuthCallback } from './lib/oauth';
import { processCodingTask } from './lib/queue';
import { handleAgentSessionWebhook } from './lib/webhook';

vi.mock('@linear/sdk/webhooks', () => {
	const LinearWebhookClient = vi.fn().mockImplementation(function () {
		return {
			createHandler: () => {
				const handlers = new Map<string, ((payload: unknown) => Promise<void>)[]>();
				const handler = Object.assign(
					vi.fn(async (request: Request) => {
						const signature = request.headers.get('linear-signature');
						if (!signature) return new Response('Missing webhook signature', { status: 400 });
						if (signature === 'invalid') return new Response('Invalid webhook', { status: 400 });
						const payload = (await request.json()) as { type?: string };
						const list = handlers.get(payload.type ?? '') ?? [];
						await Promise.all(list.map((h) => h(payload)));
						return new Response('OK', { status: 200 });
					}),
					{
						on: vi.fn((type: string, cb: (payload: unknown) => Promise<void>) => {
							const list = handlers.get(type) ?? [];
							list.push(cb);
							handlers.set(type, list);
						}),
					}
				);
				return handler;
			},
		};
	});
	return { LinearWebhookClient };
});

vi.mock('./lib/oauth', () => ({
	handleOAuthAuthorize: vi.fn().mockResolvedValue(new Response('authorize', { status: 200 })),
	handleOAuthCallback: vi.fn().mockResolvedValue(new Response('callback', { status: 200 })),
}));

vi.mock('./lib/webhook', () => ({
	handleAgentSessionWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./lib/queue', () => ({
	processCodingTask: vi.fn().mockResolvedValue(undefined),
}));

const createMockEnv = (): Env =>
	({
		LINEAR_WEBHOOK_SECRET: 'secret',
	}) as Env;

const createExecutionContext = (): ExecutionContext =>
	({
		waitUntil: vi.fn<ExecutionContext['waitUntil']>(),
		passThroughOnException: vi.fn<ExecutionContext['passThroughOnException']>(),
	}) as unknown as ExecutionContext;

describe('fetch handler', () => {
	let env: Env;
	let executionContext: ExecutionContext;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(handleAgentSessionWebhook).mockResolvedValue(undefined);

		env = createMockEnv();
		executionContext = createExecutionContext();
	});

	it('responds on root path', async () => {
		const request = new Request('https://worker.example.com/');
		const response = await worker.fetch(request, env, executionContext);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('linear-opencode-agent is running');
	});

	it('routes to oauth authorize', async () => {
		const request = new Request('https://worker.example.com/oauth/authorize');
		const response = await worker.fetch(request, env, executionContext);
		expect(handleOAuthAuthorize).toHaveBeenCalledWith(request, env);
		expect(response.status).toBe(200);
	});

	it('routes to oauth callback', async () => {
		const request = new Request('https://worker.example.com/oauth/callback');
		const response = await worker.fetch(request, env, executionContext);
		expect(handleOAuthCallback).toHaveBeenCalledWith(request, env);
		expect(response.status).toBe(200);
	});

	it('returns 500 when webhook secret is missing', async () => {
		const request = new Request('https://worker.example.com/webhook', { method: 'POST' });
		const response = await worker.fetch(request, {} as Env, executionContext);
		expect(response.status).toBe(500);
	});

	it('returns 400 when webhook verification fails', async () => {
		const request = new Request('https://worker.example.com/webhook', {
			method: 'POST',
			headers: { 'linear-signature': 'invalid' },
			body: JSON.stringify({ type: 'AgentSessionEvent' }),
		});
		const response = await worker.fetch(request, env, executionContext);
		expect(response.status).toBe(400);
		expect(handleAgentSessionWebhook).not.toHaveBeenCalled();
	});

	it('return 405 when called with wrong method', async () => {
		const request = new Request('https://worker.example.com/webhook', { method: 'PUT' });
		const response = await worker.fetch(request, env, executionContext);
		expect(response.status).toBe(405);
	});

	it('routes verified webhooks to handler', async () => {
		const payload = {
			type: 'AgentSessionEvent',
			action: 'created',
			agentSession: { id: 'as-1', issueId: 'i-1' },
			organizationId: 'org-1',
		};
		const request = new Request('https://worker.example.com/webhook', {
			method: 'POST',
			headers: { 'linear-signature': 'valid', 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		});
		const testEnv = createMockEnv();
		const response = await worker.fetch(request, testEnv, executionContext);
		expect(handleAgentSessionWebhook).toHaveBeenCalledWith(testEnv, payload);
		expect(response.status).toBe(200);
	});

	it('returns 404 for unknown paths', async () => {
		const request = new Request('https://worker.example.com/unknown');
		const response = await worker.fetch(request, env, executionContext);
		expect(response.status).toBe(404);
	});
});

describe('queue handler', () => {
	let env: Env;

	beforeEach(() => {
		env = createMockEnv();
	});

	it('processes queue messages and acks them', async () => {
		const message = {
			id: 'msg-1',
			body: { action: 'created', agentSessionId: 's1', organizationId: 'org-1', payload: {} },
			ack: vi.fn<() => void>(),
			retry: vi.fn<() => void>(),
		} as unknown as MessageBatch<CodingTaskMessage>['messages'][number];
		const batch = { messages: [message] } as unknown as MessageBatch<CodingTaskMessage>;
		await worker.queue(batch, env);
		expect(processCodingTask).toHaveBeenCalledWith(message.body, env);
		expect(message.ack).toHaveBeenCalled();
	});
});
