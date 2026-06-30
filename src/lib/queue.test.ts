import type { AgentSessionEventWebhookPayload } from '@linear/sdk';
import type { Part } from '@opencode-ai/sdk';
import type { Mock } from 'vitest';

import { AgentActivityType } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingTaskMessage, Env, OpenSpecChange } from '../types';

import {
	createLinearClient,
	emitAgentActivity,
	postIssueComment,
	removeAgentDelegate,
	updateSessionExternalUrl,
} from './linear';
import {
	createOpencodeClient,
	createOpencodeSession,
	getOpencodeSession,
	listOpencodeSessionMessages,
	promptOpencodeSessionAsync,
} from './opencode';
import { buildDelegationPrompt, buildMentionPrompt, MENTION_READ_ONLY_TOOLS } from './prompts';
import { processCodingTask } from './queue';
import { translatePart } from './translator';

vi.mock('./linear', () => ({
	createLinearClient: vi.fn(),
	emitAgentActivity: vi.fn(),
	postIssueComment: vi.fn(),
	removeAgentDelegate: vi.fn(),
	updateSessionExternalUrl: vi.fn(),
}));

vi.mock('./opencode', () => ({
	createOpencodeClient: vi.fn(),
	createOpencodeSession: vi.fn(),
	getOpencodeSession: vi.fn(),
	listOpencodeSessionMessages: vi.fn(),
	promptOpencodeSessionAsync: vi.fn(),
}));

vi.mock('./prompts', () => ({
	buildDelegationPrompt: vi.fn().mockReturnValue('delegation prompt'),
	buildMentionPrompt: vi.fn().mockReturnValue('mention prompt'),
	MENTION_READ_ONLY_TOOLS: { read: true },
}));

vi.mock('./translator', () => ({
	translatePart: vi.fn().mockReturnValue(null),
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
		OPENCODE_SERVER_PASSWORD: 'secret',
		SESSION_STATE: { get, put } as unknown as KVNamespace,
		REPO_MAP: {} as unknown as KVNamespace,
		CODING_TASKS: { send } as unknown as Queue<CodingTaskMessage>,
	} as Env;
	return { env, get, put, send };
};

const createMockOpencodeClient = () => {
	return {} as unknown as ReturnType<typeof createOpencodeClient>;
};

const createBasePayload = (
	action: 'created' | 'prompted',
	overrides: Partial<AgentSessionEventWebhookPayload> = {}
): AgentSessionEventWebhookPayload =>
	({
		action,
		agentSession: {
			id: 'session-1',
			issue: { id: 'issue-1', identifier: 'ENG-1', title: 'Issue' } as never,
		} as never,
		organizationId: 'org-1',
		promptContext: 'context',
		...overrides,
	}) as AgentSessionEventWebhookPayload;

const createMessage = (
	action: 'created' | 'prompted',
	overrides: Partial<CodingTaskMessage> = {}
): CodingTaskMessage =>
	({
		action,
		agentSessionId: 'session-1',
		organizationId: 'org-1',
		opencodeServerUrl: 'https://opencode.example.com/my-repo/',
		payload: createBasePayload(action),
		...overrides,
	}) as CodingTaskMessage;

const linearClient = { id: 'linear-client' } as never;

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.mocked(createLinearClient).mockResolvedValue(linearClient);
	vi.mocked(createOpencodeClient).mockReturnValue(createMockOpencodeClient());
	vi.mocked(createOpencodeSession).mockResolvedValue('opencode-session-1');
	vi.mocked(promptOpencodeSessionAsync).mockResolvedValue(undefined);
	vi.mocked(getOpencodeSession).mockResolvedValue({ status: { type: 'completed' } } as never);
	vi.mocked(listOpencodeSessionMessages).mockResolvedValue([]);
	vi.mocked(emitAgentActivity).mockResolvedValue(undefined);
	vi.mocked(updateSessionExternalUrl).mockResolvedValue(undefined);
	vi.mocked(postIssueComment).mockResolvedValue(undefined);
	vi.mocked(removeAgentDelegate).mockResolvedValue(undefined);
	vi.mocked(translatePart).mockReturnValue(null);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('processCodingTask', () => {
	let mockEnv: MockEnv;

	beforeEach(() => {
		mockEnv = createMockEnv();
	});

	it('returns early when no linear token exists', async () => {
		const { env } = mockEnv;
		vi.mocked(createLinearClient).mockResolvedValue(null);

		await processCodingTask(createMessage('created'), env);

		expect(createOpencodeClient).not.toHaveBeenCalled();
	});

	it('handles a mention created flow', async () => {
		const { env, put } = mockEnv;
		const payload = createBasePayload('created', {
			agentSession: { id: 'session-1', comment: { body: 'Hi', id: 'comment-1' } as never } as never,
		});

		const taskPromise = processCodingTask(createMessage('created', { payload }), env);
		await vi.advanceTimersByTimeAsync(6000);
		await taskPromise;

		expect(buildMentionPrompt).toHaveBeenCalledWith(payload);
		expect(promptOpencodeSessionAsync).toHaveBeenCalledWith(
			expect.anything(),
			'opencode-session-1',
			'mention prompt',
			{ tools: MENTION_READ_ONLY_TOOLS }
		);
		expect(put).toHaveBeenCalledWith(
			'map:session-1',
			expect.stringContaining('https://opencode.example.com/my-repo/'),
			expect.anything()
		);
	});

	it('aborts delegation when openspec marker is missing', async () => {
		const { env } = mockEnv;
		const payload = createBasePayload('created');

		await processCodingTask(createMessage('created', { payload }), env);

		expect(emitAgentActivity).toHaveBeenCalledWith(
			linearClient,
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Error,
				body: expect.stringContaining('No'),
			})
		);
		expect(postIssueComment).toHaveBeenCalled();
		expect(removeAgentDelegate).toHaveBeenCalled();
		expect(createOpencodeSession).not.toHaveBeenCalled();
	});

	it('runs delegation flow when openspec change is valid', async () => {
		const { env } = mockEnv;
		const payload = createBasePayload('created', {
			agentSession: {
				id: 'session-1',
				issue: {
					id: 'issue-1',
					identifier: 'ENG-1',
					title: 'Issue',
					description: '<!-- openspec-change: feat-1 -->',
				} as never,
			} as never,
		});
		const client = createMockOpencodeClient();
		vi.mocked(createOpencodeClient).mockReturnValue(client);

		const taskPromise = processCodingTask(createMessage('created', { payload }), env);
		await vi.advanceTimersByTimeAsync(6000);
		await taskPromise;

		const expectedChange: OpenSpecChange = {
			name: 'feat-1',
			branchName: 'feat/feat-1',
			directoryPath: 'openspec/changes/feat-1',
		};
		expect(buildDelegationPrompt).toHaveBeenCalledWith(payload, expectedChange);
		expect(createOpencodeSession).toHaveBeenCalled();
		expect(promptOpencodeSessionAsync).toHaveBeenCalledWith(
			expect.anything(),
			'opencode-session-1',
			'delegation prompt',
			{}
		);
	});

	it('emits an error when prompted without a session map', async () => {
		const { env, get } = mockEnv;
		get.mockResolvedValue(null);

		await processCodingTask(createMessage('prompted'), env);

		expect(emitAgentActivity).toHaveBeenCalledWith(
			linearClient,
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Error,
				body: expect.stringContaining('Could not find'),
			})
		);
		expect(promptOpencodeSessionAsync).not.toHaveBeenCalled();
	});

	it('resumes a prompted session from the map', async () => {
		const { env, get } = mockEnv;
		get.mockResolvedValue(
			JSON.stringify({
				kind: 'map',
				opencodeSessionId: 'existing-session',
				opencodeServerUrl: 'https://opencode.example.com/my-repo/',
			})
		);

		const payload = createBasePayload('prompted', {
			agentActivity: { content: { body: 'Follow up' } } as never,
		});

		const taskPromise = processCodingTask(createMessage('prompted', { payload }), env);
		await vi.advanceTimersByTimeAsync(6000);
		await taskPromise;

		expect(promptOpencodeSessionAsync).toHaveBeenCalledWith(
			expect.anything(),
			'existing-session',
			'Follow up',
			{}
		);
	});

	it('emits translated parts during polling', async () => {
		const { env } = mockEnv;
		const payload = createBasePayload('created', {
			agentSession: {
				id: 'session-1',
				comment: { body: 'Hi', id: 'comment-1' } as never,
			} as never,
		});

		vi.mocked(translatePart).mockReturnValue({
			type: AgentActivityType.Response,
			body: 'Done',
		} as never);
		vi.mocked(listOpencodeSessionMessages).mockResolvedValue([
			{
				info: { id: 'm1' },
				parts: [{ id: 'p1', type: 'text', text: 'Done' } as unknown as Part],
			},
		] as never);

		const taskPromise = processCodingTask(createMessage('created', { payload }), env);
		await vi.advanceTimersByTimeAsync(6000);
		await taskPromise;

		expect(emitAgentActivity).toHaveBeenCalledWith(
			linearClient,
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Response,
				body: 'Done',
			})
		);
	});
});
