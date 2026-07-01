import type { AgentSessionEventWebhookPayload } from '@linear/sdk';
import type { Mock } from 'vitest';

import { LinearClient } from '@linear/sdk';
import { AgentActivityType } from '@linear/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingTaskMessage, Env } from '../types';

import { emitAgentActivity, postIssueComment, removeAgentDelegate } from './linear';
import { getOAuthToken } from './oauth';
import { handleAgentSessionWebhook } from './webhook';

const { mockAgent, MockOpenCodeAgent, mockMapping } = vi.hoisted(() => ({
	mockAgent: { createSession: vi.fn() },
	MockOpenCodeAgent: vi.fn(),
	mockMapping: { resolveRepositoryName: vi.fn() },
}));

vi.mock('./linear', () => ({
	emitAgentActivity: vi.fn(),
	postIssueComment: vi.fn(),
	removeAgentDelegate: vi.fn(),
}));

vi.mock('./mapping', () => ({ Mapping: mockMapping }));

vi.mock('./oauth', () => ({
	getOAuthToken: vi.fn(),
}));

vi.mock('./opencode', () => ({
	OpenCodeAgent: MockOpenCodeAgent,
}));

interface MockEnv {
	env: Env;
	get: Mock<(key: string) => Promise<string | null>>;
	put: Mock<(key: string, value: string) => Promise<void>>;
	send: Mock<(body: CodingTaskMessage) => Promise<void>>;
}

const createMockEnv = (): MockEnv => {
	const get = vi.fn<(key: string) => Promise<string | null>>();
	const put = vi.fn<(key: string, value: string) => Promise<void>>();
	const send = vi.fn<(body: CodingTaskMessage) => Promise<void>>();
	const env = {
		OPENCODE_SERVER_URL: 'https://opencode.example.com',
		SESSION_STATE: { get, put } as unknown as KVNamespace,
		CODING_TASKS: { send } as unknown as Queue<CodingTaskMessage>,
	} as Env;
	return { env, get, put, send };
};

const createPayload = (
	action: 'created' | 'prompted',
	overrides: Partial<AgentSessionEventWebhookPayload> = {}
): AgentSessionEventWebhookPayload =>
	({
		action,
		agentSession: { id: 'session-1', issueId: 'issue-1' } as never,
		organizationId: 'org-1',
		...overrides,
	}) as AgentSessionEventWebhookPayload;

const resolvedMapping = (repositoryName = 'my-org/my-repo') => ({
	repositoryName,
	issue: { id: 'issue-1', title: 'Fix the bug' } as never,
});

beforeEach(() => {
	vi.clearAllMocks();
	MockOpenCodeAgent.mockImplementation(function () {
		return mockAgent;
	});
	vi.mocked(emitAgentActivity).mockResolvedValue(undefined);
	vi.mocked(postIssueComment).mockResolvedValue(undefined);
	vi.mocked(removeAgentDelegate).mockResolvedValue(undefined);
	vi.mocked(getOAuthToken).mockResolvedValue('linear-token');
	mockMapping.resolveRepositoryName.mockResolvedValue(resolvedMapping() as never);
	mockAgent.createSession.mockResolvedValue({ id: 'opencode-session-1' } as never);
});

describe('handleAgentSessionWebhook', () => {
	it('returns early when the webhook marker already exists', async () => {
		const { env, get, send } = createMockEnv();
		get.mockImplementation((key) => Promise.resolve(key === 'webhook:session-1' ? 'marker' : null));

		await handleAgentSessionWebhook(env, createPayload('created'));

		expect(getOAuthToken).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it('returns early when no linear oauth token is stored', async () => {
		const { env, get, send } = createMockEnv();
		get.mockResolvedValue(null);
		vi.mocked(getOAuthToken).mockResolvedValue(null);

		await handleAgentSessionWebhook(env, createPayload('created'));

		expect(emitAgentActivity).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it('writes the webhook marker before doing any other work', async () => {
		const { env, get, put } = createMockEnv();
		get.mockResolvedValue(null);
		vi.mocked(getOAuthToken).mockResolvedValue(null);

		await handleAgentSessionWebhook(env, createPayload('created'));

		expect(put).toHaveBeenCalledWith(
			'webhook:session-1',
			expect.stringContaining('marker'),
			expect.objectContaining({ expirationTtl: expect.any(Number) })
		);
	});

	it('aborts with an error activity when repo mapping is missing', async () => {
		const { env, get, send } = createMockEnv();
		get.mockResolvedValue(null);
		mockMapping.resolveRepositoryName.mockResolvedValue(null);

		await handleAgentSessionWebhook(env, createPayload('created'));

		expect(emitAgentActivity).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Error,
				body: expect.stringContaining('not mapped'),
			})
		);
		expect(postIssueComment).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'issue-1',
			expect.any(String)
		);
		expect(removeAgentDelegate).toHaveBeenCalledWith(expect.any(LinearClient), 'issue-1');
		expect(send).not.toHaveBeenCalled();
	});

	it('does not post a comment or remove delegate when issueId is missing', async () => {
		const { env, get, send } = createMockEnv();
		get.mockResolvedValue(null);
		mockMapping.resolveRepositoryName.mockResolvedValue(null);

		await handleAgentSessionWebhook(
			env,
			createPayload('created', { agentSession: { id: 'session-1' } as never })
		);

		expect(emitAgentActivity).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			expect.objectContaining({ type: AgentActivityType.Error })
		);
		expect(postIssueComment).not.toHaveBeenCalled();
		expect(removeAgentDelegate).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it('creates an opencode session and queues a coding task', async () => {
		const { env, get, put, send } = createMockEnv();
		get.mockResolvedValue(null);
		const expectedBaseUrl = 'https://opencode.example.com/my-org/my-repo';

		await handleAgentSessionWebhook(env, createPayload('created'));

		expect(MockOpenCodeAgent).toHaveBeenCalledWith(env, expectedBaseUrl);
		expect(mockAgent.createSession).toHaveBeenCalledWith('Fix the bug');
		expect(put).toHaveBeenCalledWith('session-1', 'opencode-session-1');
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'created',
				agentSessionId: 'session-1',
				organizationId: 'org-1',
				issueId: 'issue-1',
				openCodeBaseUrl: expectedBaseUrl,
				openCodeSessionId: 'opencode-session-1',
			})
		);
	});

	it('reuses a stored opencode session id without creating a new one', async () => {
		const { env, get, send } = createMockEnv();
		get.mockImplementation((key) => {
			if (key === 'webhook:session-1') return Promise.resolve(null);
			if (key === 'session-1') return Promise.resolve('existing-session');
			return Promise.resolve(null);
		});

		await handleAgentSessionWebhook(env, createPayload('prompted'));

		expect(mockAgent.createSession).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'prompted',
				openCodeSessionId: 'existing-session',
			})
		);
	});

	it('emits resolved and queued thoughts on the happy path', async () => {
		const { env, get } = createMockEnv();
		get.mockResolvedValue(null);

		await handleAgentSessionWebhook(env, createPayload('created'));

		const thoughtBodies = vi
			.mocked(emitAgentActivity)
			.mock.calls.map((call) => call[2])
			.filter((content) => content?.type === AgentActivityType.Thought)
			.map((content) => (content as { body: string }).body);

		expect(thoughtBodies).toContain('Resolved repository name');
		expect(thoughtBodies).toContain('Created OpenCode session');
		expect(thoughtBodies.some((body) => body.includes('Queued'))).toBe(true);
	});
});
