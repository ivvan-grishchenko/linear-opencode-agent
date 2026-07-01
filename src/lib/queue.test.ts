import type { AgentSessionEventWebhookPayload } from '@linear/sdk';
import type { Event, Part } from '@opencode-ai/sdk';
import type { Mock } from 'vitest';

import { LinearClient } from '@linear/sdk';
import { AgentActivityType } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingTaskMessage, Env, OpenSpecChange } from '../types';

import { abortDelegation, emitAgentActivity, updateSessionExternalUrl } from './linear';
import { getOAuthToken } from './oauth';
import { buildDelegationPrompt, buildMentionPrompt, MENTION_READ_ONLY_TOOLS } from './prompts';
import { processCodingTask } from './queue';
import { translatePart } from './translator';

const { mockAgent, MockOpenCodeAgent } = vi.hoisted(() => ({
	mockAgent: {
		getEventsStream: vi.fn(),
		isSessionFinished: vi.fn(),
		promptAsync: vi.fn(),
		getMessages: vi.fn(),
	},
	MockOpenCodeAgent: vi.fn(),
}));

vi.mock('./oauth', () => ({
	getOAuthToken: vi.fn(),
}));

vi.mock('./linear', () => ({
	abortDelegation: vi.fn(),
	emitAgentActivity: vi.fn(),
	updateSessionExternalUrl: vi.fn(),
}));

vi.mock('./opencode', () => ({
	OpenCodeAgent: MockOpenCodeAgent,
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
}

const createMockEnv = (): MockEnv => {
	const get = vi.fn<(key: string) => Promise<string | null>>();
	const put = vi.fn<(key: string, value: string) => Promise<void>>();
	const env = {
		SESSION_STATE: { get, put } as unknown as KVNamespace,
	} as Env;
	return { env, get, put };
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
		issueId: 'issue-1',
		openCodeSessionId: 'opencode-session-1',
		openCodeBaseUrl: 'https://opencode.example.com/my-repo/',
		payload: createBasePayload(action),
		...overrides,
	}) as CodingTaskMessage;

const idleEvent = (sessionID: string): Event =>
	({ type: 'session.idle', properties: { sessionID } }) as Event;

const partUpdatedEvent = (part: Part): Event =>
	({ type: 'message.part.updated', properties: { part } }) as Event;

const sessionErrorEvent = (
	sessionID: string,
	error?: { name: string; data: { message?: string } }
): Event => ({ type: 'session.error', properties: { sessionID, error } }) as Event;

const toolPart = (
	id: string,
	status: 'pending' | 'running' | 'completed' | 'error' = 'completed'
): Part =>
	({
		id,
		sessionID: 'opencode-session-1',
		messageID: 'm1',
		type: 'tool',
		tool: 'read',
		callID: 'c1',
		state: { status, input: { path: 'foo.ts' } },
	}) as unknown as Part;

const textPart = (id: string, text: string): Part =>
	({
		id,
		sessionID: 'opencode-session-1',
		messageID: 'm1',
		type: 'text',
		text,
	}) as unknown as Part;

const eventStream = (events: Event[]): AsyncGenerator<Event> =>
	(async function* () {
		for (const e of events) yield e;
	})();

const delegationPayload = () =>
	createBasePayload('created', {
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

beforeEach(() => {
	vi.clearAllMocks();
	MockOpenCodeAgent.mockImplementation(function () {
		return mockAgent;
	});
	vi.mocked(getOAuthToken).mockResolvedValue('linear-token');
	vi.mocked(emitAgentActivity).mockResolvedValue(undefined);
	vi.mocked(abortDelegation).mockResolvedValue(undefined);
	vi.mocked(updateSessionExternalUrl).mockResolvedValue(undefined);
	vi.mocked(buildDelegationPrompt).mockReturnValue('delegation prompt');
	vi.mocked(buildMentionPrompt).mockReturnValue('mention prompt');
	vi.mocked(translatePart).mockReturnValue(null);
	mockAgent.promptAsync.mockResolvedValue(undefined);
	mockAgent.isSessionFinished.mockResolvedValue(true);
	mockAgent.getMessages.mockResolvedValue([]);
	mockAgent.getEventsStream.mockResolvedValue(eventStream([idleEvent('opencode-session-1')]));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('processCodingTask', () => {
	let mockEnv: MockEnv;

	beforeEach(() => {
		mockEnv = createMockEnv();
		const { get } = mockEnv;
		get.mockImplementation((key: string) => {
			if (key === 'queue:session-1') return Promise.resolve(null);
			if (key === 'session-1') return Promise.resolve('opencode-session-1');
			return Promise.resolve(null);
		});
	});

	it('returns early when no linear token exists', async () => {
		const { env } = mockEnv;
		vi.mocked(getOAuthToken).mockResolvedValue(null);

		await processCodingTask(createMessage('created'), env);

		expect(MockOpenCodeAgent).not.toHaveBeenCalled();
		expect(emitAgentActivity).not.toHaveBeenCalled();
	});

	it('aborts delegation when openspec marker is missing', async () => {
		const { env } = mockEnv;
		const payload = createBasePayload('created');

		await processCodingTask(createMessage('created', { payload }), env);

		expect(abortDelegation).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			'issue-1',
			expect.stringContaining('No')
		);
		expect(MockOpenCodeAgent).not.toHaveBeenCalled();
		expect(mockAgent.promptAsync).not.toHaveBeenCalled();
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

		await processCodingTask(createMessage('created', { payload }), env);

		const expectedChange: OpenSpecChange = {
			name: 'feat-1',
			branchName: 'feat/feat-1',
			directoryPath: 'openspec/changes/feat-1',
		};
		expect(buildDelegationPrompt).toHaveBeenCalledWith(payload, expectedChange);
		expect(MockOpenCodeAgent).toHaveBeenCalledWith(env, 'https://opencode.example.com/my-repo/');
		expect(mockAgent.promptAsync).toHaveBeenCalledWith('opencode-session-1', 'delegation prompt');
		expect(mockAgent.getEventsStream).toHaveBeenCalled();
	});

	it('emits an error when prompted without a stored opencode session id', async () => {
		const { env, get } = mockEnv;
		get.mockImplementation((key: string) => {
			if (key === 'queue:session-1') return Promise.resolve(null);
			return Promise.resolve(null);
		});

		await processCodingTask(createMessage('prompted'), env);

		expect(emitAgentActivity).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Error,
				body: expect.stringContaining('open code session id'),
			})
		);
		expect(mockAgent.promptAsync).not.toHaveBeenCalled();
	});

	it('emits an error when openCodeBaseUrl is missing', async () => {
		const { env } = mockEnv;

		await processCodingTask(createMessage('created', { openCodeBaseUrl: '' }), env);

		expect(emitAgentActivity).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Error,
				body: expect.stringContaining('opencode server URL'),
			})
		);
		expect(MockOpenCodeAgent).not.toHaveBeenCalled();
	});

	it('resumes a prompted session using the stored opencode session id', async () => {
		const { env, get } = mockEnv;
		get.mockImplementation((key: string) => {
			if (key === 'queue:session-1') return Promise.resolve(null);
			if (key === 'session-1') return Promise.resolve('existing-session');
			return Promise.resolve(null);
		});
		const payload = createBasePayload('prompted', {
			agentActivity: { content: { body: 'Follow up' } } as never,
		});

		await processCodingTask(createMessage('prompted', { payload }), env);

		expect(buildMentionPrompt).toHaveBeenCalledWith(payload);
		expect(mockAgent.promptAsync).toHaveBeenCalledWith(
			'existing-session',
			'mention prompt',
			MENTION_READ_ONLY_TOOLS
		);
		expect(mockAgent.getEventsStream).toHaveBeenCalled();
	});

	it('skips as a duplicate when the queue marker already exists', async () => {
		const { env, get } = mockEnv;
		get.mockImplementation((key: string) => {
			if (key === 'queue:session-1') return Promise.resolve('session-1');
			return Promise.resolve(null);
		});

		await processCodingTask(createMessage('created'), env);

		expect(emitAgentActivity).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Thought,
				body: expect.stringContaining('duplicate'),
			})
		);
		expect(MockOpenCodeAgent).not.toHaveBeenCalled();
	});

	it('skips stream events that belong to a foreign opencode session', async () => {
		const { env } = mockEnv;
		mockAgent.getEventsStream.mockResolvedValue(
			eventStream([idleEvent('foreign-session'), idleEvent('opencode-session-1')])
		);
		mockAgent.isSessionFinished.mockResolvedValue(true);

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

		await processCodingTask(createMessage('created', { payload }), env);

		expect(mockAgent.isSessionFinished).toHaveBeenCalledTimes(1);
		expect(mockAgent.isSessionFinished).toHaveBeenCalledWith('opencode-session-1');
	});

	it('keeps polling when a matching session.idle is not finished', async () => {
		const { env } = mockEnv;
		mockAgent.getEventsStream.mockResolvedValue(eventStream([idleEvent('opencode-session-1')]));
		mockAgent.isSessionFinished.mockResolvedValue(false);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		expect(mockAgent.isSessionFinished).toHaveBeenCalledWith('opencode-session-1');
	});

	it('emits translated activity for non-text parts during streaming', async () => {
		const { env } = mockEnv;
		const translated = { type: AgentActivityType.Action, action: 'read', parameter: 'foo.ts' };
		vi.mocked(translatePart).mockReturnValue(translated as never);
		mockAgent.getEventsStream.mockResolvedValue(
			eventStream([partUpdatedEvent(toolPart('p1', 'completed')), idleEvent('opencode-session-1')])
		);
		mockAgent.isSessionFinished.mockResolvedValue(false);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		expect(translatePart).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'p1', type: 'tool' }),
			{ isFinal: false }
		);
		expect(emitAgentActivity).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			translated
		);
	});

	it('skips text parts during streaming', async () => {
		const { env } = mockEnv;
		mockAgent.getEventsStream.mockResolvedValue(
			eventStream([
				partUpdatedEvent(textPart('p1', 'interim text')),
				idleEvent('opencode-session-1'),
			])
		);
		mockAgent.isSessionFinished.mockResolvedValue(false);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		expect(translatePart).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'text' }), {
			isFinal: false,
		});
	});

	it('skips tool running state to avoid duplicate with pending', async () => {
		const { env } = mockEnv;
		vi.mocked(translatePart).mockReturnValue({
			type: AgentActivityType.Action,
			action: 'read',
			parameter: 'foo.ts',
		} as never);
		mockAgent.getEventsStream.mockResolvedValue(
			eventStream([partUpdatedEvent(toolPart('p1', 'running')), idleEvent('opencode-session-1')])
		);
		mockAgent.isSessionFinished.mockResolvedValue(false);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		expect(translatePart).not.toHaveBeenCalled();
	});

	it('deduplicates repeated part updates with same id and status', async () => {
		const { env } = mockEnv;
		vi.mocked(translatePart).mockReturnValue({
			type: AgentActivityType.Action,
			action: 'read',
			parameter: 'foo.ts',
		} as never);
		const part = toolPart('p1', 'completed');
		mockAgent.getEventsStream.mockResolvedValue(
			eventStream([partUpdatedEvent(part), partUpdatedEvent(part), idleEvent('opencode-session-1')])
		);
		mockAgent.isSessionFinished.mockResolvedValue(false);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		const actionCalls = vi
			.mocked(emitAgentActivity)
			.mock.calls.filter((call) => call[2]?.type === AgentActivityType.Action);
		expect(actionCalls).toHaveLength(1);
	});

	it('emits final text as Response on session completion', async () => {
		const { env } = mockEnv;
		const finalText = textPart('p9', 'Done. PR created at https://github.com/org/repo/pull/42');
		mockAgent.getMessages.mockResolvedValue([
			{
				info: {
					id: 'm1',
					role: 'assistant',
					sessionID: 'opencode-session-1',
					time: { created: 1, completed: 2 },
				} as never,
				parts: [finalText],
			},
		] as never);
		vi.mocked(translatePart).mockImplementation((part, context) => {
			if (part.type === 'text' && context.isFinal) {
				return { type: AgentActivityType.Response, body: part.text } as never;
			}
			return null;
		});
		mockAgent.getEventsStream.mockResolvedValue(eventStream([idleEvent('opencode-session-1')]));
		mockAgent.isSessionFinished.mockResolvedValue(true);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		expect(translatePart).toHaveBeenCalledWith(finalText, { isFinal: true });
		expect(emitAgentActivity).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Response,
				body: 'Done. PR created at https://github.com/org/repo/pull/42',
			})
		);
		expect(updateSessionExternalUrl).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			'https://github.com/org/repo/pull/42'
		);
	});

	it('does not link a PR for mention flows', async () => {
		const { env } = mockEnv;
		const finalText = textPart('p9', 'Done. PR created at https://github.com/org/repo/pull/42');
		mockAgent.getMessages.mockResolvedValue([
			{
				info: {
					id: 'm1',
					role: 'assistant',
					sessionID: 'opencode-session-1',
					time: { created: 1, completed: 2 },
				} as never,
				parts: [finalText],
			},
		] as never);
		vi.mocked(translatePart).mockImplementation((part, context) => {
			if (part.type === 'text' && context.isFinal) {
				return { type: AgentActivityType.Response, body: part.text } as never;
			}
			return null;
		});
		mockAgent.getEventsStream.mockResolvedValue(eventStream([idleEvent('opencode-session-1')]));
		mockAgent.isSessionFinished.mockResolvedValue(true);

		await processCodingTask(createMessage('prompted'), env);

		expect(updateSessionExternalUrl).not.toHaveBeenCalled();
	});

	it('emits earlier text parts as Thoughts and last as Response', async () => {
		const { env } = mockEnv;
		const firstText = textPart('p1', 'Let me check the file');
		const lastText = textPart('p2', 'Fixed it. PR at https://example.com/pr/1');
		mockAgent.getMessages.mockResolvedValue([
			{
				info: {
					id: 'm1',
					role: 'assistant',
					sessionID: 'opencode-session-1',
					time: { created: 1, completed: 2 },
				} as never,
				parts: [firstText, lastText],
			},
		] as never);
		vi.mocked(translatePart).mockImplementation((part, context) => {
			if (part.type === 'text') {
				return context.isFinal
					? ({ type: AgentActivityType.Response, body: part.text } as never)
					: ({ type: AgentActivityType.Thought, body: part.text } as never);
			}
			return null;
		});
		mockAgent.getEventsStream.mockResolvedValue(eventStream([idleEvent('opencode-session-1')]));
		mockAgent.isSessionFinished.mockResolvedValue(true);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		expect(translatePart).toHaveBeenCalledWith(firstText, { isFinal: false });
		expect(translatePart).toHaveBeenCalledWith(lastText, { isFinal: true });
	});

	it('emits error activity on session.error', async () => {
		const { env } = mockEnv;
		mockAgent.getEventsStream.mockResolvedValue(
			eventStream([
				sessionErrorEvent('opencode-session-1', {
					name: 'ProviderAuthError',
					data: { message: 'Invalid API key' },
				}),
				idleEvent('opencode-session-1'),
			])
		);
		mockAgent.isSessionFinished.mockResolvedValue(true);
		mockAgent.getMessages.mockResolvedValue([]);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		expect(emitAgentActivity).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Error,
				body: expect.stringContaining('Invalid API key'),
			})
		);
	});

	it('emits generic error message when session.error has no error detail', async () => {
		const { env } = mockEnv;
		mockAgent.getEventsStream.mockResolvedValue(
			eventStream([
				sessionErrorEvent('opencode-session-1', undefined),
				idleEvent('opencode-session-1'),
			])
		);
		mockAgent.isSessionFinished.mockResolvedValue(true);
		mockAgent.getMessages.mockResolvedValue([]);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		expect(emitAgentActivity).toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			expect.objectContaining({
				type: AgentActivityType.Error,
				body: expect.stringContaining('unknown error'),
			})
		);
	});

	it('ignores session.error from a foreign session', async () => {
		const { env } = mockEnv;
		mockAgent.getEventsStream.mockResolvedValue(
			eventStream([
				sessionErrorEvent('foreign-session', {
					name: 'ApiError',
					data: { message: 'should be skipped' },
				}),
				idleEvent('opencode-session-1'),
			])
		);
		mockAgent.isSessionFinished.mockResolvedValue(true);
		mockAgent.getMessages.mockResolvedValue([]);

		await processCodingTask(createMessage('created', { payload: delegationPayload() }), env);

		expect(emitAgentActivity).not.toHaveBeenCalledWith(
			expect.any(LinearClient),
			'session-1',
			expect.objectContaining({ body: expect.stringContaining('should be skipped') })
		);
	});
});
