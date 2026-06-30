import { LinearClient } from '@linear/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env, StoredTokenData } from '../types';

import { getStoredToken, setStoredToken } from './linear';
import {
	getOAuthToken,
	getWorkspaceTokenKey,
	handleOAuthAuthorize,
	handleOAuthCallback,
} from './oauth';

const { mockOrganization } = vi.hoisted(() => ({
	mockOrganization: vi.fn().mockResolvedValue({ id: 'org-id', name: 'org-name' }),
}));

vi.mock('./linear', () => ({
	getStoredToken: vi.fn(),
	setStoredToken: vi.fn(),
	getWorkspaceTokenKey: vi.fn((id: string) => `linear_oauth_token_${id}`),
}));
vi.mock('@linear/sdk', () => {
	class LinearError extends Error {}

	return {
		LinearClient: vi.fn(function (this: Record<string, unknown>) {
			Object.defineProperty(this, 'organization', {
				get: () => mockOrganization(),
			});
		}),
		LinearError,
	};
});

const createMockEnv = (): Env =>
	({
		LINEAR_CLIENT_ID: 'client-id',
		LINEAR_CLIENT_SECRET: 'client-secret',
		WORKER_URL: 'https://worker.example.com',
	}) as Env;

const mockFetch = (
	responses: Array<{ ok: boolean; status?: number; text?: string; json?: unknown }>
) => {
	let callIndex = 0;
	return vi.fn().mockImplementation(() => {
		const response = responses[callIndex++] ?? { ok: false, text: 'unexpected fetch' };
		return Promise.resolve({
			ok: response.ok,
			status: response.status ?? (response.ok ? 200 : 400),
			text: () => Promise.resolve(response.text ?? ''),
			json: () => Promise.resolve(response.json ?? {}),
		} as Response);
	});
};

describe('getWorkspaceTokenKey re-export', () => {
	it('matches the linear helper prefix', () => {
		expect(getWorkspaceTokenKey('ws-1')).toBe('linear_oauth_token_ws-1');
	});
});

describe('handleOAuthAuthorize', () => {
	let env: Env;

	beforeEach(() => {
		env = createMockEnv();
	});
	it('builds the linear oauth url with required parameters', () => {
		const request = new Request('https://worker.example.com/oauth/authorize?state=my-state');
		const response = handleOAuthAuthorize(request, env);

		expect(response.status).toBe(302);
		const location = response.headers.get('Location')!;
		expect(location).toContain('https://linear.app/oauth/authorize');
		expect(location).toContain('client_id=client-id');
		expect(location).toContain('response_type=code');
		expect(location).toContain('actor=app');
		expect(location).toContain('state=my-state');
		expect(location).toContain(encodeURIComponent('https://worker.example.com/oauth/callback'));
	});
});

describe('handleOAuthCallback', () => {
	let env: Env;

	beforeEach(() => {
		env = createMockEnv();
	});

	it('returns 400 on oauth error', async () => {
		const request = new Request('https://worker.example.com/oauth/callback?error=access_denied');
		const response = await handleOAuthCallback(request, env);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain('access_denied');
	});

	it('returns 400 when code is missing', async () => {
		const request = new Request('https://worker.example.com/oauth/callback');
		const response = await handleOAuthCallback(request, env);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain('Missing authorization code');
	});

	it('returns 400 when token exchange fails', async () => {
		globalThis.fetch = mockFetch([{ ok: false, text: 'invalid code' }]);
		const request = new Request('https://worker.example.com/oauth/callback?code=abc');
		const response = await handleOAuthCallback(request, env);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain('Token exchange failed');
	});

	it('exchanges code, stores token, and returns success html', async () => {
		globalThis.fetch = mockFetch([
			{
				ok: true,
				json: {
					access_token: 'access-1',
					refresh_token: 'refresh-1',
					expires_in: 3600,
				},
			},
		]);

		const request = new Request('https://worker.example.com/oauth/callback?code=abc');
		const response = await handleOAuthCallback(request, env);

		expect(response.status).toBe(200);
		expect(LinearClient).toHaveBeenCalledWith({ accessToken: 'access-1' });
		expect(mockOrganization).toHaveBeenCalledOnce();

		const text = await response.text();
		expect(text).toContain('Authorization successful');
		expect(text).toContain('org-name');
		expect(setStoredToken).toHaveBeenCalledWith(
			env,
			'org-id',
			expect.objectContaining({
				access_token: 'access-1',
				refresh_token: 'refresh-1',
			})
		);
	});
});

describe('getOAuthToken', () => {
	let env: Env;

	beforeEach(() => {
		env = createMockEnv();
	});

	it('returns null when no token is stored', async () => {
		vi.mocked(getStoredToken).mockResolvedValue(null);
		expect(await getOAuthToken(env, 'ws-1')).toBeNull();
	});

	it('returns access token when still valid', async () => {
		const token: StoredTokenData = {
			access_token: 'access-1',
			refresh_token: 'refresh-1',
			expires_at: Date.now() + 60 * 60 * 1000,
		};
		vi.mocked(getStoredToken).mockResolvedValue(token);
		expect(await getOAuthToken(env, 'ws-1')).toBe('access-1');
	});

	it('refreshes an expired token and stores it', async () => {
		const token: StoredTokenData = {
			access_token: 'access-old',
			refresh_token: 'refresh-1',
			expires_at: Date.now() - 1000,
		};
		vi.mocked(getStoredToken).mockResolvedValue(token);
		globalThis.fetch = mockFetch([
			{
				ok: true,
				json: {
					access_token: 'access-new',
					refresh_token: 'refresh-new',
					expires_in: 3600,
				},
			},
		]);

		const result = await getOAuthToken(env, 'ws-1');
		expect(result).toBe('access-new');
		expect(setStoredToken).toHaveBeenCalledWith(
			env,
			'ws-1',
			expect.objectContaining({ access_token: 'access-new' })
		);
	});

	it('returns null when refresh fails', async () => {
		const token: StoredTokenData = {
			access_token: 'access-old',
			refresh_token: 'refresh-1',
			expires_at: Date.now() - 1000,
		};
		vi.mocked(getStoredToken).mockResolvedValue(token);
		globalThis.fetch = mockFetch([{ ok: false, text: 'bad refresh' }]);

		expect(await getOAuthToken(env, 'ws-1')).toBeNull();
	});

	it('returns null when token expired and no refresh token exists', async () => {
		const token: StoredTokenData = {
			access_token: 'access-old',
			refresh_token: '',
			expires_at: Date.now() - 1000,
		};
		vi.mocked(getStoredToken).mockResolvedValue(token);
		expect(await getOAuthToken(env, 'ws-1')).toBeNull();
	});
});
