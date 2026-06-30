import { LinearClient, LinearError } from '@linear/sdk';

import type { Env, StoredTokenData } from '../types';

import { getStoredToken, getWorkspaceTokenKey, setStoredToken } from './linear';

const SCOPES = 'read,write,app:assignable,app:mentionable';

export function handleOAuthAuthorize(request: Request, env: Env): Response {
	const url = new URL(request.url);
	const state = url.searchParams.get('state') ?? '';

	const authUrl = new URL('https://linear.app/oauth/authorize');

	authUrl.searchParams.set('client_id', env.LINEAR_CLIENT_ID);
	authUrl.searchParams.set('redirect_uri', `${env.WORKER_URL}/oauth/callback`);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('scope', SCOPES);
	authUrl.searchParams.set('actor', 'app');
	if (state) authUrl.searchParams.set('state', state);

	return new Response(null, {
		status: 302,
		headers: { Location: authUrl.toString() },
	});
}

export async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const code = url.searchParams.get('code');
	const error = url.searchParams.get('error');

	if (error) return new Response(`OAuth error: ${error}`, { status: 400 });

	if (!code) return new Response('Missing authorization code', { status: 400 });

	const tokenResponse = await fetch('https://api.linear.app/oauth/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: env.LINEAR_CLIENT_ID,
			client_secret: env.LINEAR_CLIENT_SECRET,
			code,
			redirect_uri: `${env.WORKER_URL}/oauth/callback`,
		}),
	});

	if (!tokenResponse.ok) {
		const text = await tokenResponse.text();
		return new Response(`Token exchange failed: ${text}`, { status: 400 });
	}

	const tokenData: {
		access_token: string;
		refresh_token: string;
		expires_in: number;
	} = await tokenResponse.json();

	const workspaceInfo = await getWorkspaceInfo(tokenData.access_token);
	const stored: StoredTokenData = {
		access_token: tokenData.access_token,
		refresh_token: tokenData.refresh_token,
		expires_at: Date.now() + tokenData.expires_in * 1000,
	};

	await setStoredToken(env, workspaceInfo.id, stored);

	return new Response(
		`<html><body>
      <h1>Authorization successful</h1>
      <p>Workspace: <strong>${escapeHtml(workspaceInfo.name)}</strong></p>
      <p>You can now assign issues or @mention the agent.</p>
    </body></html>`,
		{
			status: 200,
			headers: { 'Content-Type': 'text/html' },
		}
	);
}

export async function getOAuthToken(env: Env, workspaceId: string): Promise<string | null> {
	const tokenData = await getStoredToken(env, workspaceId);
	if (!tokenData) return null;

	const buffer = 5 * 60 * 1000;
	if (Date.now() < tokenData.expires_at - buffer) return tokenData.access_token;

	if (!tokenData.refresh_token) return null;

	try {
		const refreshed = await refreshAccessToken(env, tokenData.refresh_token);
		const stored: StoredTokenData = {
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: Date.now() + refreshed.expires_in * 1000,
		};
		await setStoredToken(env, workspaceId, stored);
		return stored.access_token;
	} catch {
		return null;
	}
}

async function refreshAccessToken(
	env: Env,
	refreshToken: string
): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const response = await fetch('https://api.linear.app/oauth/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			client_id: env.LINEAR_CLIENT_ID,
			client_secret: env.LINEAR_CLIENT_SECRET,
			refresh_token: refreshToken,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Token refresh failed: ${text}`);
	}

	return await response.json();
}

async function getWorkspaceInfo(accessToken: string): Promise<{ id: string; name: string }> {
	try {
		const linearClient = new LinearClient({ accessToken });
		const organization = await linearClient.organization;

		return { id: organization.id, name: organization.name };
	} catch (err) {
		if (err instanceof LinearError) throw err;

		throw new Error('Unknown error', { cause: err });
	}
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export { getWorkspaceTokenKey };
