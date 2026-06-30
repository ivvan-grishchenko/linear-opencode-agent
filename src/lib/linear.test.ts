import type { Mock } from 'vitest';

import { AgentActivityType, LinearClient } from '@linear/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env, StoredTokenData } from '../types';
import type { ActivityContent } from './linear';

import {
	createLinearClient,
	emitAgentActivity,
	getStoredToken,
	getWorkspaceTokenKey,
	postIssueComment,
	removeAgentDelegate,
	setStoredToken,
	updateSessionExternalUrl,
} from './linear';

interface MockEnv {
	env: Env;
	get: Mock<(key: string) => Promise<string | null>>;
	put: Mock<(key: string, value: string) => Promise<void>>;
}

const createMockEnv = (): MockEnv => {
	const get = vi.fn<(key: string) => Promise<string | null>>();
	const put = vi.fn<(key: string, value: string) => Promise<void>>();
	const env = {
		LINEAR_TOKENS: { get, put } as unknown as KVNamespace,
	} as Env;
	return { env, get, put };
};

describe('getWorkspaceTokenKey', () => {
	it('prefixes the workspace id', () => {
		expect(getWorkspaceTokenKey('ws-1')).toBe('linear_oauth_token_ws-1');
	});
});

describe('getStoredToken', () => {
	let mockEnv: MockEnv;

	beforeEach(() => {
		mockEnv = createMockEnv();
	});
	it('returns parsed token when present', async () => {
		const { env, get } = mockEnv;
		const token: StoredTokenData = {
			access_token: 'token',
			refresh_token: 'refresh',
			expires_at: 123456,
		};
		get.mockResolvedValue(JSON.stringify(token));

		const result = await getStoredToken(env, 'ws-1');
		expect(result).toEqual(token);
		expect(get).toHaveBeenCalledWith('linear_oauth_token_ws-1');
	});

	it('returns null when token is missing', async () => {
		const { env, get } = mockEnv;
		get.mockResolvedValue(null);
		expect(await getStoredToken(env, 'ws-1')).toBeNull();
	});

	it('returns null when token json is invalid', async () => {
		const { env, get } = mockEnv;
		get.mockResolvedValue('not-json');
		expect(await getStoredToken(env, 'ws-1')).toBeNull();
	});
});

describe('setStoredToken', () => {
	let mockEnv: MockEnv;

	beforeEach(() => {
		mockEnv = createMockEnv();
	});

	it('stores serialized token', async () => {
		const { env, put } = mockEnv;
		const token: StoredTokenData = {
			access_token: 'token',
			refresh_token: 'refresh',
			expires_at: 123456,
		};
		await setStoredToken(env, 'ws-1', token);
		expect(put).toHaveBeenCalledWith('linear_oauth_token_ws-1', JSON.stringify(token));
	});
});

describe('createLinearClient', () => {
	let mockEnv: MockEnv;

	beforeEach(() => {
		mockEnv = createMockEnv();
	});

	it('returns null when token is missing', async () => {
		const { env, get } = mockEnv;
		get.mockResolvedValue(null);
		expect(await createLinearClient(env, 'ws-1')).toBeNull();
	});

	it('returns null when token is expiring soon', async () => {
		const { env, get } = createMockEnv();
		const token: StoredTokenData = {
			access_token: 'token',
			refresh_token: 'refresh',
			expires_at: Date.now() + 60 * 1000,
		};
		get.mockResolvedValue(JSON.stringify(token));
		expect(await createLinearClient(env, 'ws-1')).toBeNull();
	});

	it('returns LinearClient when token is valid', async () => {
		const { env, get } = createMockEnv();
		const token: StoredTokenData = {
			access_token: 'valid-token',
			refresh_token: 'refresh',
			expires_at: Date.now() + 60 * 60 * 1000,
		};
		get.mockResolvedValue(JSON.stringify(token));
		const client = await createLinearClient(env, 'ws-1');
		expect(client).toBeInstanceOf(LinearClient);
	});
});

describe('Linear SDK wrappers', () => {
	let client: LinearClient;

	beforeEach(() => {
		client = new LinearClient({ accessToken: 'token' });
		client.createAgentActivity = vi.fn().mockResolvedValue(undefined);
		client.agentSessionUpdateExternalUrl = vi.fn().mockResolvedValue(undefined);
		client.updateIssue = vi.fn().mockResolvedValue(undefined);
		client.createComment = vi.fn().mockResolvedValue(undefined);
	});

	it('emitAgentActivity calls createAgentActivity with content', async () => {
		const content: ActivityContent = { type: AgentActivityType.Thought, body: 'Thinking' };
		await emitAgentActivity(client, 'session-1', content);
		expect(client.createAgentActivity).toHaveBeenCalledWith({
			agentSessionId: 'session-1',
			content,
		});
	});

	it('updateSessionExternalUrl calls agentSessionUpdateExternalUrl', async () => {
		await updateSessionExternalUrl(client, 'session-1', 'https://example.com/pr/1');
		expect(client.agentSessionUpdateExternalUrl).toHaveBeenCalledWith('session-1', {
			externalUrls: [{ label: 'Pull Request', url: 'https://example.com/pr/1' }],
		});
	});

	it('removeAgentDelegate sets delegateId to null', async () => {
		await removeAgentDelegate(client, 'issue-1');
		expect(client.updateIssue).toHaveBeenCalledWith('issue-1', { delegateId: null });
	});

	it('postIssueComment creates a comment', async () => {
		await postIssueComment(client, 'issue-1', 'A comment');
		expect(client.createComment).toHaveBeenCalledWith({ issueId: 'issue-1', body: 'A comment' });
	});
});
