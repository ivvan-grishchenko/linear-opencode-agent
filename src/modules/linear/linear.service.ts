import type { Issue, LinearClient } from '@linear/sdk';
import type { IOauthService } from '@modules/oauth';

import { AgentActivityType, LinearClient as LinearSdkClient } from '@linear/sdk';
import { OauthInject } from '@modules/oauth';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { ILinearService } from './linear.service.interface';
import type { ActivityContent } from './linear.type';

@Injectable()
export class LinearService implements ILinearService {
	private readonly logger = new Logger(LinearService.name);

	constructor(
		@Inject(OauthInject.SERVICE)
		private readonly oauthService: IOauthService
	) {}

	async getClient(workspaceId: string): Promise<LinearClient | null> {
		const accessToken = await this.oauthService.getAccessToken(workspaceId);

		if (!accessToken) return null;

		return new LinearSdkClient({ accessToken });
	}

	async emitAgentActivity(
		client: LinearClient,
		agentSessionId: string,
		content: ActivityContent
	): Promise<void> {
		await client.createAgentActivity({ agentSessionId, content });
	}

	async updateSessionExternalUrl(
		client: LinearClient,
		agentSessionId: string,
		url: string
	): Promise<void> {
		await client.agentSessionUpdateExternalUrl(agentSessionId, {
			externalUrls: [{ label: 'Pull Request', url }],
		});
	}

	async removeAgentDelegate(client: LinearClient, issueId: string): Promise<void> {
		await client.updateIssue(issueId, { delegateId: null });
	}

	async postIssueComment(client: LinearClient, issueId: string, body: string): Promise<void> {
		await client.createComment({ body, issueId });
	}

	async abortDelegation(
		client: LinearClient,
		agentSessionId: string,
		issueId: string | undefined,
		message: string
	): Promise<void> {
		await this.emitAgentActivity(client, agentSessionId, {
			body: message,
			type: AgentActivityType.Error,
		});

		if (!issueId) return;

		try {
			await Promise.all([
				this.postIssueComment(client, issueId, `Agent could not start: ${message}`),
				this.removeAgentDelegate(client, issueId),
			]);
		} catch (error) {
			this.logger.error('Failed to clean up issue after abort', error);
		}
	}

	async getIssue(client: LinearClient, issueId: string): Promise<Issue> {
		return client.issue(issueId);
	}
}
