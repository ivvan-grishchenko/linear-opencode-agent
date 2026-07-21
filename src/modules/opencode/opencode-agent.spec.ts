import type { AssistantMessage, Message, Session } from '@opencode-ai/sdk';

import { createOpencodeClient } from '@opencode-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenCodeAgent } from './opencode-agent';

const mockClient = {
	event: {
		subscribe: vi.fn(),
	},
	session: {
		create: vi.fn(),
		get: vi.fn(),
		messages: vi.fn(),
		promptAsync: vi.fn(),
	},
};

vi.mock('@opencode-ai/sdk', () => ({
	createOpencodeClient: vi.fn(() => mockClient as any),
}));

describe('openCodeAgent', () => {
	beforeEach(() => {
		OpenCodeAgent.reset();
		vi.clearAllMocks();
	});

	afterEach(() => {
		OpenCodeAgent.reset();
	});

	describe('constructor', () => {
		it('should create a new agent when baseUrl is not cached', () => {
			const agent = new OpenCodeAgent('http://localhost:3000', 'password');

			expect(agent).toBeInstanceOf(OpenCodeAgent);
		});

		it('should create client with correct auth header', () => {
			new OpenCodeAgent('http://test.com', 'secret');

			expect(vi.mocked(createOpencodeClient)).toHaveBeenCalledWith({
				baseUrl: 'http://test.com',
				headers: {
					Authorization: `Basic ${Buffer.from('opencode:secret').toString('base64')}`,
				},
			});
		});

		it('should return cached agent when same baseUrl is used', () => {
			const agent1 = new OpenCodeAgent('http://localhost:3000', 'password');
			const agent2 = new OpenCodeAgent('http://localhost:3000', 'other-password');

			expect(agent2).toBe(agent1);
		});

		it('should create separate agents for different baseUrls', () => {
			const agent1 = new OpenCodeAgent('http://localhost:3000', 'password');
			const agent2 = new OpenCodeAgent('http://localhost:3001', 'password');

			expect(agent2).not.toBe(agent1);
		});
	});

	describe('createSession', () => {
		it('should return session data on success', async () => {
			const sessionData: Session = { id: 'session-1' } as Session;
			mockClient.session.create.mockResolvedValue({ data: sessionData });

			const agent = new OpenCodeAgent('http://localhost:3000', 'password');
			const result = await agent.createSession('Test Session');

			expect(mockClient.session.create).toHaveBeenCalledWith({
				body: { title: 'Test Session' },
			});
			expect(result).toBe(sessionData);
		});

		it('should throw when response data is empty', async () => {
			mockClient.session.create.mockResolvedValue({ data: null });

			const agent = new OpenCodeAgent('http://localhost:3000', 'password');

			await expect(agent.createSession('Test')).rejects.toThrow(
				'Failed to create opencode session: empty response'
			);
		});
	});

	describe('getEventsStream', () => {
		it('should return stream from event subscribe', async () => {
			const stream = (async function* stream() {})();
			mockClient.event.subscribe.mockResolvedValue({ stream });

			const agent = new OpenCodeAgent('http://localhost:3000', 'password');
			const result = await agent.getEventsStream({ signal: new AbortController().signal });

			expect(mockClient.event.subscribe).toHaveBeenCalledWith({
				signal: expect.any(AbortSignal),
			});
			expect(result).toBe(stream);
		});

		it('should call event subscribe without options when not provided', async () => {
			mockClient.event.subscribe.mockResolvedValue({
				stream: (async function* stream() {})(),
			});

			const agent = new OpenCodeAgent('http://localhost:3000', 'password');
			await agent.getEventsStream();

			expect(mockClient.event.subscribe).toHaveBeenCalledWith({});
		});
	});

	describe('getSession', () => {
		it('should return session data on success', async () => {
			const sessionData: Session = { id: 'session-1' } as Session;
			mockClient.session.get.mockResolvedValue({ data: sessionData });

			const agent = new OpenCodeAgent('http://localhost:3000', 'password');
			const result = await agent.getSession('session-1');

			expect(mockClient.session.get).toHaveBeenCalledWith({
				path: { id: 'session-1' },
			});
			expect(result).toBe(sessionData);
		});

		it('should throw when response data is empty', async () => {
			mockClient.session.get.mockResolvedValue({ data: null });

			const agent = new OpenCodeAgent('http://localhost:3000', 'password');

			await expect(agent.getSession('session-1')).rejects.toThrow(
				'Failed to get opencode session: empty response'
			);
		});
	});

	describe('isSessionFinished', () => {
		let agent: OpenCodeAgent;

		beforeEach(() => {
			agent = new OpenCodeAgent('http://localhost:3000', 'password');
		});

		it('should throw when response data is falsy', async () => {
			mockClient.session.messages.mockResolvedValue({ data: null });

			await expect(agent.isSessionFinished('session-1')).rejects.toThrow(
				'Failed to get opencode session: empty response'
			);
		});

		it('should return false when there are no messages', async () => {
			mockClient.session.messages.mockResolvedValue({ data: [] });

			const result = await agent.isSessionFinished('session-1');

			expect(result).toBeFalsy();
		});

		it('should return false when last message has no info', async () => {
			mockClient.session.messages.mockResolvedValue({
				data: [{ info: null, parts: [] }],
			});

			const result = await agent.isSessionFinished('session-1');

			expect(result).toBeFalsy();
		});

		it('should return false when last message is not an assistant message', async () => {
			mockClient.session.messages.mockResolvedValue({
				data: [
					{
						info: { role: 'user' } as Message,
						parts: [],
					},
				],
			});

			const result = await agent.isSessionFinished('session-1');

			expect(result).toBeFalsy();
		});

		it('should return false when assistant message has no completed time', async () => {
			mockClient.session.messages.mockResolvedValue({
				data: [
					{
						info: { role: 'assistant', time: { completed: null } } as unknown as AssistantMessage,
						parts: [],
					},
				],
			});

			const result = await agent.isSessionFinished('session-1');

			expect(result).toBeFalsy();
		});

		it('should return true when assistant message has completed time', async () => {
			mockClient.session.messages.mockResolvedValue({
				data: [
					{
						info: {
							role: 'assistant',
							time: { completed: '2024-01-01T00:00:00Z' },
						} as unknown as AssistantMessage,
						parts: [],
					},
				],
			});

			const result = await agent.isSessionFinished('session-1');

			expect(result).toBeTruthy();
		});
	});

	describe('getMessages', () => {
		let agent: OpenCodeAgent;

		beforeEach(() => {
			agent = new OpenCodeAgent('http://localhost:3000', 'password');
		});

		it('should return empty array when response data is falsy', async () => {
			mockClient.session.messages.mockResolvedValue({ data: null });

			const result = await agent.getMessages('session-1');

			expect(result).toStrictEqual([]);
		});

		it('should return messages data on success', async () => {
			const messages = [{ info: { role: 'assistant' } as Message, parts: [] }];
			mockClient.session.messages.mockResolvedValue({ data: messages });

			const result = await agent.getMessages('session-1');

			expect(result).toBe(messages);
		});
	});

	describe('promptAsync', () => {
		let agent: OpenCodeAgent;

		beforeEach(() => {
			agent = new OpenCodeAgent('http://localhost:3000', 'password');
		});

		it('should call promptAsync with parts and tools', async () => {
			await agent.promptAsync('session-1', 'Hello', { tools: { tool1: true } });

			expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
				body: { parts: [{ text: 'Hello', type: 'text' }], tools: { tool1: true } },
				path: { id: 'session-1' },
			});
		});

		it('should call promptAsync without tools when not provided', async () => {
			await agent.promptAsync('session-1', 'Hello');

			expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
				body: { parts: [{ text: 'Hello', type: 'text' }], tools: undefined },
				path: { id: 'session-1' },
			});
		});
	});

	describe('static reset', () => {
		it('should clear the cache', () => {
			const agent1 = new OpenCodeAgent('http://localhost:3000', 'password');
			OpenCodeAgent.reset();
			const agent2 = new OpenCodeAgent('http://localhost:3000', 'password');

			expect(agent2).not.toBe(agent1);
		});
	});
});
