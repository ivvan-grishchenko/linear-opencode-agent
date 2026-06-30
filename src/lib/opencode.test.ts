import type { OpencodeClient } from '@opencode-ai/sdk';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../types';

import {
	createOpencodeClient,
	createOpencodeSession,
	getOpencodeSession,
	listOpencodeSessionMessages,
	promptOpencodeSessionAsync,
} from './opencode';

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

describe('createOpencodeClient', () => {
	let mockClient: OpencodeClient;
	let env: Env;

	beforeEach(() => {
		mockClient = createMockClient();
		env = createMockEnv();
	});

	it('creates a client with the provided base url and wrapped fetch', async () => {
		createSdkClient.mockReturnValue(mockClient);

		const client = createOpencodeClient(env, 'https://opencode.example.com/my-repo/');

		expect(createSdkClient).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'https://opencode.example.com/my-repo/',
				fetch: expect.any(Function),
			})
		);
		expect(client).toBe(mockClient);
	});

	it('adds basic auth header to every outgoing request', async () => {
		createSdkClient.mockReturnValue(mockClient);
		const mockGlobalFetch = vi.fn().mockResolvedValue(new Response());
		globalThis.fetch = mockGlobalFetch;

		createOpencodeClient(env, 'https://opencode.example.com/my-repo/');
		const wrappedFetch = createSdkClient.mock.calls[0][0].fetch;

		const mockRequest = {
			url: 'https://opencode.example.com/my-repo/session',
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		};

		await wrappedFetch(mockRequest);

		expect(mockGlobalFetch).toHaveBeenCalledWith(
			'https://opencode.example.com/my-repo/session',
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

describe('createOpencodeSession', () => {
	let client: OpencodeClient;

	beforeEach(() => {
		client = createMockClient();
	});

	it('returns the session id', async () => {
		vi.mocked(client.session.create).mockResolvedValue({ data: { id: 'session-1' } } as never);
		const id = await createOpencodeSession(client, 'My session');
		expect(id).toBe('session-1');
		expect(client.session.create).toHaveBeenCalledWith({
			body: { title: 'My session' },
		});
	});

	it('throws when response is empty', async () => {
		vi.mocked(client.session.create).mockResolvedValue({ data: null } as never);
		await expect(createOpencodeSession(client)).rejects.toThrow(
			'Failed to create opencode session: empty response'
		);
	});
});

describe('promptOpencodeSessionAsync', () => {
	let client: OpencodeClient;

	beforeEach(() => {
		client = createMockClient();
	});

	it('sends a text prompt with optional tools', async () => {
		vi.mocked(client.session.promptAsync).mockResolvedValue(undefined as never);
		await promptOpencodeSessionAsync(client, 'session-1', 'Hello', {
			tools: { read: true },
		});
		expect(client.session.promptAsync).toHaveBeenCalledWith({
			path: { id: 'session-1' },
			body: {
				parts: [{ type: 'text', text: 'Hello' }],
				tools: { read: true },
			},
		});
	});
});

describe('getOpencodeSession', () => {
	let client: OpencodeClient;

	beforeEach(() => {
		client = createMockClient();
	});

	it('returns session data', async () => {
		const session = { id: 'session-1', status: 'running' };
		vi.mocked(client.session.get).mockResolvedValue({ data: session } as never);
		expect(await getOpencodeSession(client, 'session-1')).toBe(session);
	});

	it('throws when response is empty', async () => {
		const client = createMockClient();
		vi.mocked(client.session.get).mockResolvedValue({ data: null } as never);
		await expect(getOpencodeSession(client, 'session-1')).rejects.toThrow(
			'Failed to get opencode session: empty response'
		);
	});
});

describe('listOpencodeSessionMessages', () => {
	let client: OpencodeClient;

	beforeEach(() => {
		client = createMockClient();
	});
	it('returns normalized messages', async () => {
		const messages = [{ info: { id: 'm1' }, parts: [{ id: 'p1', type: 'text', text: 'Hi' }] }];
		vi.mocked(client.session.messages).mockResolvedValue({ data: messages } as never);
		const result = await listOpencodeSessionMessages(client, 'session-1');
		expect(result).toEqual(messages);
	});

	it('returns empty array when response is empty', async () => {
		vi.mocked(client.session.messages).mockResolvedValue({ data: null } as never);
		expect(await listOpencodeSessionMessages(client, 'session-1')).toEqual([]);
	});
});
