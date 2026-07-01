import type { OpencodeClient, Session } from '@opencode-ai/sdk';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../types';

import { OpenCodeAgent } from './opencode';

const { createSdkClient } = vi.hoisted(() => ({ createSdkClient: vi.fn() }));

vi.mock('@opencode-ai/sdk', () => ({
	createOpencodeClient: createSdkClient,
}));

const createMockEnv = (overrides: Partial<Env> = {}): Env =>
	({
		OPENCODE_SERVER_URL: 'https://opencode.example.com',
		OPENCODE_SERVER_PASSWORD: 'secret',
		...overrides,
	}) as Env;

const createMockClient = () =>
	({
		session: {
			create: vi.fn(),
			promptAsync: vi.fn(),
			get: vi.fn(),
			messages: vi.fn(),
		},
	}) as unknown as OpencodeClient;

const baseUrl = 'https://opencode.example.com/my-repo/';

describe('OpenCodeAgent', () => {
	describe('constructor', () => {
		let mockClient: OpencodeClient;
		let env: Env;

		beforeEach(() => {
			OpenCodeAgent.reset();
			vi.clearAllMocks();
			mockClient = createMockClient();
			env = createMockEnv();
		});

		it('creates an SDK client with the provided base url and wrapped fetch', () => {
			createSdkClient.mockReturnValue(mockClient);

			// oxlint-disable-next-line no-new
			new OpenCodeAgent(env, baseUrl);

			expect(createSdkClient).toHaveBeenCalledWith(
				expect.objectContaining({
					baseUrl,
					fetch: expect.any(Function),
				})
			);
		});

		it('returns the same instance for the same base url', () => {
			createSdkClient.mockReturnValue(mockClient);

			const first = new OpenCodeAgent(env, baseUrl);
			const second = new OpenCodeAgent(env, baseUrl);

			expect(second).toBe(first);
			expect(createSdkClient).toHaveBeenCalledTimes(1);
		});

		it('creates separate instances for different base urls', () => {
			createSdkClient.mockReturnValue(mockClient);

			const first = new OpenCodeAgent(env, baseUrl);
			const second = new OpenCodeAgent(env, 'https://opencode.example.com/other-repo/');

			expect(second).not.toBe(first);
			expect(createSdkClient).toHaveBeenCalledTimes(2);
		});

		it('adds basic auth header to every outgoing request', async () => {
			createSdkClient.mockReturnValue(mockClient);
			const mockGlobalFetch = vi.fn().mockResolvedValue(new Response());
			globalThis.fetch = mockGlobalFetch;

			// oxlint-disable-next-line no-new
			new OpenCodeAgent(env, baseUrl);
			const wrappedFetch = createSdkClient.mock.calls[0][0].fetch;

			const request = {
				url: `${baseUrl}session`,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			};

			await wrappedFetch(request);

			expect(mockGlobalFetch).toHaveBeenCalledWith(
				`${baseUrl}session`,
				expect.objectContaining({
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Basic ${Buffer.from('opencode:secret').toString('base64')}`,
					},
				})
			);
		});
	});

	describe('session operations', () => {
		let agent: OpenCodeAgent;
		let mockClient: OpencodeClient;

		beforeEach(() => {
			OpenCodeAgent.reset();
			vi.clearAllMocks();
			mockClient = createMockClient();
			createSdkClient.mockReturnValue(mockClient);
			agent = new OpenCodeAgent(createMockEnv(), baseUrl);
		});

		describe('createSession', () => {
			it('returns the session when creation succeeds', async () => {
				const session = { id: 'session-1' } as Session;
				vi.mocked(mockClient.session.create).mockResolvedValue({ data: session } as never);

				const result = await agent.createSession('My session');

				expect(result).toBe(session);
				expect(mockClient.session.create).toHaveBeenCalledWith({
					body: { title: 'My session' },
				});
			});

			it('throws when response data is empty', async () => {
				vi.mocked(mockClient.session.create).mockResolvedValue({ data: null } as never);

				await expect(agent.createSession('My session')).rejects.toThrow(
					'Failed to create opencode session: empty response'
				);
			});
		});

		describe('getSession', () => {
			it('returns session data', async () => {
				const session = { id: 'session-1' } as Session;
				vi.mocked(mockClient.session.get).mockResolvedValue({ data: session } as never);

				const result = await agent.getSession('session-1');

				expect(result).toBe(session);
				expect(mockClient.session.get).toHaveBeenCalledWith({ path: { id: 'session-1' } });
			});

			it('throws when response data is empty', async () => {
				vi.mocked(mockClient.session.get).mockResolvedValue({ data: null } as never);

				await expect(agent.getSession('session-1')).rejects.toThrow(
					'Failed to get opencode session: empty response'
				);
			});
		});

		describe('getMessages', () => {
			it('returns messages', async () => {
				const messages = [{ info: { id: 'm1' }, parts: [{ id: 'p1', type: 'text', text: 'Hi' }] }];
				vi.mocked(mockClient.session.messages).mockResolvedValue({ data: messages } as never);

				const result = await agent.getMessages('session-1');

				expect(result).toEqual(messages);
				expect(mockClient.session.messages).toHaveBeenCalledWith({ path: { id: 'session-1' } });
			});

			it('returns empty array when response data is null', async () => {
				vi.mocked(mockClient.session.messages).mockResolvedValue({ data: null } as never);

				const result = await agent.getMessages('session-1');

				expect(result).toEqual([]);
			});
		});

		describe('promptAsync', () => {
			it('sends a text prompt with optional tools', async () => {
				vi.mocked(mockClient.session.promptAsync).mockResolvedValue(undefined as never);

				await agent.promptAsync('session-1', 'Hello', { tools: { read: true } });

				expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
					path: { id: 'session-1' },
					body: {
						parts: [{ type: 'text', text: 'Hello' }],
						tools: { read: true },
					},
				});
			});

			it('sends a text prompt without tools by default', async () => {
				vi.mocked(mockClient.session.promptAsync).mockResolvedValue(undefined as never);

				await agent.promptAsync('session-1', 'Hello');

				expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
					path: { id: 'session-1' },
					body: {
						parts: [{ type: 'text', text: 'Hello' }],
						tools: undefined,
					},
				});
			});
		});
	});
});
