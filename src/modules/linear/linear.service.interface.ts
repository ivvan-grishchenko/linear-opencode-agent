import type { Issue, LinearClient } from '@linear/sdk';

import type { ActivityContent } from './linear.type';

export interface ILinearService {
	getClient(workspaceId: string): Promise<LinearClient | null>;
	emitAgentActivity(
		client: LinearClient,
		agentSessionId: string,
		content: ActivityContent
	): Promise<void>;
	updateSessionExternalUrl(
		client: LinearClient,
		agentSessionUrl: string,
		url: string
	): Promise<void>;
	removeAgentDelegate(client: LinearClient, issueId: string): Promise<void>;
	postIssueComment(client: LinearClient, issueId: string, body: string): Promise<void>;
	abortDelegation(
		client: LinearClient,
		agentSessionId: string,
		issueId: string | undefined,
		message: string
	): Promise<void>;
	getIssue(client: LinearClient, issueId: string): Promise<Issue>;
}
