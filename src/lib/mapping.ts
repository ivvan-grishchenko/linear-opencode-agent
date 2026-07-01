import type { AgentSessionEventWebhookPayload, Issue, LinearClient } from '@linear/sdk';

import type { Env } from '../types';

// oxlint-disable-next-line typescript/no-extraneous-class
class Mapping {
	static async resolveRepositoryName(
		env: Env,
		linearClient: LinearClient,
		payload: AgentSessionEventWebhookPayload
	): Promise<{ repositoryName: string; issue: Issue } | null> {
		const organizationId = payload.organizationId;
		const issueId = payload.agentSession.issueId;

		if (!organizationId || !issueId) return null;

		const issue = await linearClient.issue(issueId);
		const projectId = issue.projectId;

		if (!projectId) return null;

		const key = `repo:${organizationId}:${projectId}`;
		const raw = await env.REPO_MAP.get(key);

		return raw ? { repositoryName: raw, issue } : null;
	}
}

export { Mapping };
