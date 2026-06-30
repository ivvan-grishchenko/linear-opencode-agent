import type { AgentSessionEventWebhookPayload, LinearClient } from '@linear/sdk';

import type { Env } from '../types';

/**
 * Resolve the repository name for an issue from the REPO_MAP KV namespace.
 *
 * The mapping is keyed by `repo:<organizationId>:<projectId>` and the value
 * is the repository name as a plain string. The project id is fetched via
 * the Linear client because the webhook payload does not reliably include
 * it.
 */
export async function resolveRepositoryName(
	env: Env,
	linearClient: LinearClient,
	payload: AgentSessionEventWebhookPayload
): Promise<string | null> {
	const organizationId = payload.organizationId;
	const issueId = payload.agentSession.issue?.id;
	if (!organizationId || !issueId) return null;

	const projectId = await fetchIssueProjectId(linearClient, issueId);
	if (!projectId) return null;

	const key = buildRepoMapKey(organizationId, projectId);
	const raw = await env.REPO_MAP.get(key);
	return raw ?? null;
}

/**
 * Build the full opencode server URL for a repository.
 *
 * The Railway service exposes each repo under a path segment:
 *   <OPENCODE_SERVER_URL>/<repositoryName>/
 */
export function buildOpencodeServerUrl(env: Env, repositoryName: string): string {
	const base = env.OPENCODE_SERVER_URL.replace(/\/+$/, '');
	return `${base}/${encodeURIComponent(repositoryName)}/`;
}

export function buildRepoMapKey(organizationId: string, projectId: string): string {
	return `repo:${organizationId}:${projectId}`;
}

async function fetchIssueProjectId(
	linearClient: LinearClient,
	issueId: string
): Promise<string | null> {
	try {
		const issue = await linearClient.issue(issueId);
		if (!issue) return null;

		return issue.projectId ?? null;
	} catch {
		return null;
	}
}
