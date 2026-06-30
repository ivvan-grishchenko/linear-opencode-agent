import type { AgentSessionEventWebhookPayload, LinearClient } from '@linear/sdk';
import type { Mock } from 'vitest';

import { AgentActivityType } from '@linear/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingTaskMessage, Env } from '../types';

import {
	createLinearClient,
	emitAgentActivity,
	postIssueComment,
	removeAgentDelegate,
} from './linear';
import { handleAgentSessionWebhook, verifyWebhook } from './webhook';

const SECRET = 'my-secret';

vi.mock('./linear', () => ({
	createLinearClient: vi.fn(),
	emitAgentActivity: vi.fn(),
	postIssueComment: vi.fn(),
	removeAgentDelegate: vi.fn(),
}));

async function signBody(body: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
	return Array.from(new Uint8Array(mac))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function createWebhookRequest(body: string, signature: string, timestamp?: number): Request {
	const timestampValue = timestamp ?? Date.now();
	return new Request('https://worker.example.com/webhook', {
		method: 'POST',
		headers: {
			'linear-signature': signature,
			'linear-timestamp': String(timestampValue),
			'Content-Type': 'application/json',
		},
		body,
	});
}

const createMockLinearClient = (projectId: string | null = 'project-1'): LinearClient =>
	({
		issue: vi.fn().mockResolvedValue({ projectId }),
	}) as unknown as LinearClient;

const createMockEnv = (): {
	env: Env;
	get: Mock<(key: string) => Promise<string | null>>;
	put: Mock<(key: string, value: string) => Promise<void>>;
	repoGet: Mock<(key: string) => Promise<string | null>>;
	send: Mock<(body: CodingTaskMessage) => Promise<void>>;
} => {
	const get = vi.fn<(key: string) => Promise<string | null>>();
	const put = vi.fn<(key: string, value: string) => Promise<void>>();
	const repoGet = vi.fn<(key: string) => Promise<string | null>>();
	const send = vi.fn<(body: CodingTaskMessage) => Promise<void>>();
	const env = {
		OPENCODE_SERVER_URL: 'https://opencode.example.com',
		SESSION_STATE: { get, put } as unknown as KVNamespace,
		REPO_MAP: { get: repoGet } as unknown as KVNamespace,
		CODING_TASKS: { send } as unknown as Queue<CodingTaskMessage>,
	} as Env;
	return { env, get, put, repoGet, send };
};

describe('verifyWebhook', () => {
	it('returns payload for a valid webhook', async () => {
		const payload = {
			action: 'created',
			agentSession: { id: 'session-1' } as never,
			organizationId: 'org-1',
		} as unknown as AgentSessionEventWebhookPayload;
		const body = JSON.stringify(payload);
		const signature = await signBody(body, SECRET);
		const request = createWebhookRequest(body, signature);

		const result = await verifyWebhook(request, SECRET);
		expect(result.agentSession.id).toBe('session-1');
	});

	it('rejects an invalid signature', async () => {
		const request = createWebhookRequest('{}', 'bad-signature');
		await expect(verifyWebhook(request, SECRET)).rejects.toThrow('Invalid webhook signature');
	});

	it('rejects a missing timestamp', async () => {
		const body = JSON.stringify({ action: 'created', agentSession: { id: 's1' } });
		const signature = await signBody(body, SECRET);
		const request = new Request('https://worker.example.com/webhook', {
			method: 'POST',
			headers: { 'linear-signature': signature },
			body,
		});
		await expect(verifyWebhook(request, SECRET)).rejects.toThrow('Invalid webhook timestamp');
	});

	it('rejects an outdated timestamp', async () => {
		const body = JSON.stringify({ action: 'created', agentSession: { id: 's1' } });
		const signature = await signBody(body, SECRET);
		const request = createWebhookRequest(body, signature, Date.now() - 5 * 60 * 1000);
		await expect(verifyWebhook(request, SECRET)).rejects.toThrow('Webhook timestamp too old');
	});

	it('uses webhookTimestamp from payload when present', async () => {
		const body = JSON.stringify({
			action: 'created',
			agentSession: { id: 's1' },
			webhookTimestamp: Date.now(),
		});
		const signature = await signBody(body, SECRET);
		const request = createWebhookRequest(body, signature, Date.now() - 5 * 60 * 1000);
		const result = await verifyWebhook(request, SECRET);
		expect(result.agentSession.id).toBe('s1');
	});
});

describe('handleAgentSessionWebhook', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('deduplicates created webhooks using session marker', async () => {
		const { env, get, send } = createMockEnv();
		get.mockResolvedValue('{"kind":"marker"}');
		vi.mocked(createLinearClient).mockResolvedValue(createMockLinearClient());

		const payload: AgentSessionEventWebhookPayload = {
			action: 'created',
			agentSession: {
				id: 'session-1',
				issue: { id: 'issue-1' } as never,
			} as never,
			organizationId: 'org-1',
		} as never;
		const response = await handleAgentSessionWebhook(env, payload);

		expect(response.status).toBe(200);
		expect(send).not.toHaveBeenCalled();
	});

	it('queues a created task and emits an initial thought', async () => {
		const { env, get, put, repoGet, send } = createMockEnv();
		get.mockResolvedValue(null);
		repoGet.mockResolvedValue(JSON.stringify({ repositoryName: 'my-repo' }));

		const linearClient = createMockLinearClient();
		vi.mocked(createLinearClient).mockResolvedValue(linearClient);
		vi.mocked(emitAgentActivity).mockResolvedValue(undefined);

		const payload: AgentSessionEventWebhookPayload = {
			action: 'created',
			agentSession: {
				id: 'session-1',
				issue: { id: 'issue-1' } as never,
			} as never,
			organizationId: 'org-1',
		} as never;
		const response = await handleAgentSessionWebhook(env, payload);

		expect(response.status).toBe(200);
		expect(put).toHaveBeenCalledWith(
			'marker:session-1',
			expect.stringContaining('marker'),
			expect.objectContaining({ expirationTtl: expect.any(Number) })
		);
		expect(emitAgentActivity).toHaveBeenCalledWith(
			linearClient,
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Thought,
				body: expect.stringContaining('Queued'),
			})
		);
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'created',
				agentSessionId: 'session-1',
				organizationId: 'org-1',
				opencodeServerUrl: 'https://opencode.example.com/my-repo/',
			})
		);
	});

	it('returns 200 without enqueueing when linear client cannot be created', async () => {
		const { env, get, put, send } = createMockEnv();
		get.mockResolvedValue(null);
		vi.mocked(createLinearClient).mockResolvedValue(null);

		const payload: AgentSessionEventWebhookPayload = {
			action: 'created',
			agentSession: {
				id: 'session-1',
				issue: { id: 'issue-1' } as never,
			} as never,
			organizationId: 'org-1',
		} as never;
		const response = await handleAgentSessionWebhook(env, payload);

		expect(response.status).toBe(200);
		expect(send).not.toHaveBeenCalled();
		expect(put).not.toHaveBeenCalled();
		expect(emitAgentActivity).not.toHaveBeenCalled();
	});

	it('aborts created delegation when repo mapping is missing', async () => {
		const { env, get, put, repoGet, send } = createMockEnv();
		get.mockResolvedValue(null);
		repoGet.mockResolvedValue(null);

		const linearClient = createMockLinearClient();
		vi.mocked(createLinearClient).mockResolvedValue(linearClient);
		vi.mocked(emitAgentActivity).mockResolvedValue(undefined);
		vi.mocked(postIssueComment).mockResolvedValue(undefined);
		vi.mocked(removeAgentDelegate).mockResolvedValue(undefined);

		const payload: AgentSessionEventWebhookPayload = {
			action: 'created',
			agentSession: {
				id: 'session-1',
				issue: { id: 'issue-1' } as never,
			} as never,
			organizationId: 'org-1',
		} as never;
		const response = await handleAgentSessionWebhook(env, payload);

		expect(response.status).toBe(200);
		expect(put).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
		expect(emitAgentActivity).toHaveBeenCalledWith(
			linearClient,
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Error,
				body: expect.stringContaining('not mapped'),
			})
		);
		expect(postIssueComment).toHaveBeenCalled();
		expect(removeAgentDelegate).toHaveBeenCalled();
	});

	it('queues a prompted task', async () => {
		const { env, send } = createMockEnv();

		const payload: AgentSessionEventWebhookPayload = {
			action: 'prompted',
			agentSession: { id: 'session-1' } as never,
			organizationId: 'org-1',
		} as never;
		const response = await handleAgentSessionWebhook(env, payload);

		expect(response.status).toBe(200);
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'prompted',
				agentSessionId: 'session-1',
				organizationId: 'org-1',
			})
		);
	});

	it('returns 200 for unknown actions', async () => {
		const { env } = createMockEnv();
		const payload = {
			action: 'deleted',
			agentSession: { id: 'session-1' } as never,
			organizationId: 'org-1',
		} as unknown as AgentSessionEventWebhookPayload;
		const response = await handleAgentSessionWebhook(env, payload);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('Unhandled action');
	});
});
