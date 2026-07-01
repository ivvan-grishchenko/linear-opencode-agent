import { LinearClient, AgentActivityType } from '@linear/sdk';

import type { StoredTokenData, Env } from '../types';

const OAUTH_TOKEN_KEY_PREFIX = 'linear_oauth_token_';

type ActivityContent =
	| { type: AgentActivityType.Thought; body: string }
	| { type: AgentActivityType.Action; action: string; parameter: string; result?: string }
	| { type: AgentActivityType.Response; body: string }
	| { type: AgentActivityType.Error; body: string };

function getWorkspaceTokenKey(workspaceId: string): string {
	return `${OAUTH_TOKEN_KEY_PREFIX}${workspaceId}`;
}

async function getStoredToken(env: Env, workspaceId: string): Promise<StoredTokenData | null> {
	const raw = await env.LINEAR_TOKENS.get(getWorkspaceTokenKey(workspaceId));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as StoredTokenData;
	} catch {
		return null;
	}
}

async function setStoredToken(
	env: Env,
	workspaceId: string,
	token: StoredTokenData
): Promise<void> {
	await env.LINEAR_TOKENS.put(getWorkspaceTokenKey(workspaceId), JSON.stringify(token));
}

async function emitAgentActivity(
	client: LinearClient,
	agentSessionId: string,
	content: ActivityContent
): Promise<void> {
	await client.createAgentActivity({
		agentSessionId,
		content,
	});
}

async function updateSessionExternalUrl(
	client: LinearClient,
	agentSessionId: string,
	url: string
): Promise<void> {
	await client.agentSessionUpdateExternalUrl(agentSessionId, {
		externalUrls: [{ label: 'Pull Request', url }],
	});
}

async function removeAgentDelegate(client: LinearClient, issueId: string): Promise<void> {
	await client.updateIssue(issueId, { delegateId: null });
}

async function postIssueComment(
	client: LinearClient,
	issueId: string,
	body: string
): Promise<void> {
	await client.createComment({ issueId, body });
}

async function abortDelegation(
	linearClient: LinearClient,
	agentSessionId: string,
	issueId: string | undefined,
	message: string
): Promise<void> {
	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Error,
		body: message,
	});

	if (!issueId) return;

	try {
		await Promise.all([
			postIssueComment(linearClient, issueId, `Agent could not start: ${message}`),
			removeAgentDelegate(linearClient, issueId),
		]);
	} catch (err) {
		console.error('Failed to clean up issue after abort:', err);
	}
}

export type { ActivityContent };
export {
	getWorkspaceTokenKey,
	getStoredToken,
	setStoredToken,
	emitAgentActivity,
	updateSessionExternalUrl,
	removeAgentDelegate,
	postIssueComment,
	abortDelegation,
};
