import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from './types';

import worker from './index';
import { handleOAuthAuthorize, handleOAuthCallback } from './lib/oauth';
import { processCodingTask } from './lib/queue';
import { handleAgentSessionWebhook, verifyWebhook } from './lib/webhook';

vi.mock('./lib/oauth', () => ({
	handleOAuthAuthorize: vi.fn().mockResolvedValue(new Response('authorize', { status: 200 })),
	handleOAuthCallback: vi.fn().mockResolvedValue(new Response('callback', { status: 200 })),
}));

vi.mock('./lib/webhook', () => ({
	handleAgentSessionWebhook: vi.fn().mockReturnValue(new Response('webhook', { status: 200 })),
	verifyWebhook: vi.fn().mockResolvedValue({ action: 'created' }),
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
		vi.mocked(verifyWebhook).mockResolvedValue({ action: 'created' } as never);
		vi.mocked(handleAgentSessionWebhook).mockResolvedValue(
			new Response('webhook', { status: 200 })
		);

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

	it('returns 401 when webhook verification fails', async () => {
		const request = new Request('https://worker.example.com/webhook', { method: 'POST' });
		vi.mocked(verifyWebhook).mockRejectedValue(new Error('bad signature'));
		const response = await worker.fetch(request, env, executionContext);
		expect(response.status).toBe(401);
	});

	it('return 405 when called with wrong method', async () => {
		const request = new Request('https://worker.example.com/webhook', { method: 'PUT' });
		const response = await worker.fetch(request, env, executionContext);
		expect(response.status).toBe(405);
	});

	it('routes verified webhooks to handler', async () => {
		const request = new Request('https://worker.example.com/webhook', { method: 'POST' });
		const testEnv = createMockEnv();
		const response = await worker.fetch(request, testEnv, executionContext);
		expect(verifyWebhook).toHaveBeenCalledWith(request, 'secret');
		expect(handleAgentSessionWebhook).toHaveBeenCalledWith(testEnv, { action: 'created' });
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
		} as unknown as MessageBatch<Record<string, unknown>>['messages'][number];
		const batch = { messages: [message] } as unknown as MessageBatch<Record<string, unknown>>;
		await worker.queue(batch, env);
		expect(processCodingTask).toHaveBeenCalledWith(message.body, env);
		expect(message.ack).toHaveBeenCalled();
	});
});
