import type { AgentSessionEventWebhookPayload } from '@linear/sdk';
import type { ILinearService } from '@modules/linear';

import { LinearInject } from '@modules/linear';
import { BadRequestException, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import type { EventValidatePayload, OpenSpecParseResult } from '../agent-session.type';
import type {
	IAgentSessionEventProcessor,
	IAgentSessionRepository,
	IAgentSessionValidatorService,
} from '../interface';

import { AgentSessionInject } from '../agent-session.enum';

@Injectable()
export class AgentSessionValidatorService implements IAgentSessionValidatorService {
	private readonly logger = new Logger(AgentSessionValidatorService.name);

	constructor(
		@Inject(forwardRef(() => AgentSessionInject.PROCESSOR))
		private readonly processor: IAgentSessionEventProcessor,
		@Inject(AgentSessionInject.REPOSITORY)
		private readonly repository: IAgentSessionRepository,

		@Inject(LinearInject.SERVICE)
		private readonly linearService: ILinearService
	) {}

	parseOpenSpecChange(description: string): OpenSpecParseResult {
		const match = /<!--\s*openspec-change:\s*(?<name>\S+)\s*-->/.exec(description);

		if (!match?.groups?.name)
			return {
				message: 'No `<!-- openspec-change: <name> -->` marker found in the issue description.',
				ok: false,
				reason: 'missing-marker',
			};

		const { name } = match.groups;

		return {
			change: {
				branchName: `feat/${name}`,
				directoryPath: `openspec/changes/${name}`,
				name,
			},
			ok: true,
		};
	}

	async validateEvent(payload: AgentSessionEventWebhookPayload): Promise<EventValidatePayload> {
		const { organizationId } = payload;
		const { id: agentSessionId, issueId } = payload.agentSession;

		const client = await this.linearService.getClient(organizationId);

		if (!client) {
			this.logger.error('Linear OAuth token not found', { organizationId });
			await this.repository.updateStatus(agentSessionId, 'failed', 'Linear OAuth token not found');

			throw new BadRequestException('Linear OAuth token not found');
		}

		if (!issueId) {
			await this.processor.abort(
				client,
				agentSessionId,
				undefined,
				'No issue associated with this agent session.'
			);

			throw new BadRequestException('No issue associated with this agent session.');
		}

		const issue = await this.linearService.getIssue(client, issueId);

		const repositoryName = await this.repository.resolveRepositoryName(
			organizationId,
			issue.projectId ?? null
		);

		if (!repositoryName) {
			await this.processor.abort(
				client,
				agentSessionId,
				issueId,
				'This Linear project is not mapped to an opencode repository. Add a mapping and try again.'
			);

			throw new BadRequestException(
				'This Linear project is not mapped to an opencode repository. Add a mapping and try again.'
			);
		}

		return { client, issue, issueId, issueTitle: issue.title, repositoryName };
	}
}
