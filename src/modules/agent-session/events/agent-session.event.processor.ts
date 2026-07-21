import type { AgentSessionEventWebhookPayload, LinearClient } from '@linear/sdk';
import type { ILinearService } from '@modules/linear';
import type { IOpencodeService } from '@modules/opencode';
import type { IOpencodeEventStreamService } from '@modules/opencode-events';

import { AgentActivityType } from '@linear/sdk';
import { LinearInject } from '@modules/linear';
import { OpencodeInject } from '@modules/opencode';
import { OpencodeEventsInject } from '@modules/opencode-events';
import { Inject, Injectable, Logger } from '@nestjs/common';
// oxlint-disable-next-line typescript/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { AgentSessionCreatedEvent, AgentSessionPromptedEvent } from '../agent-session.type';
import type {
	IAgentSessionEventProcessor,
	IAgentSessionPromptService,
	IAgentSessionRepository,
	IAgentSessionValidatorService,
} from '../interface';

import { MENTION_READ_ONLY_TOOLS } from '../agent-session.constant';
import { AgentSessionInject } from '../agent-session.enum';

@Injectable()
export class AgentSessionEventProcessor implements IAgentSessionEventProcessor {
	private readonly logger = new Logger(AgentSessionEventProcessor.name);

	constructor(
		@Inject(AgentSessionInject.VALIDATOR_SERVICE)
		private readonly validatorService: IAgentSessionValidatorService,
		@Inject(AgentSessionInject.REPOSITORY)
		private readonly repository: IAgentSessionRepository,
		@Inject(AgentSessionInject.PROMPT_SERVICE)
		private readonly promptService: IAgentSessionPromptService,

		@Inject(LinearInject.SERVICE)
		private readonly linearService: ILinearService,
		@Inject(OpencodeInject.SERVICE)
		private readonly opencodeService: IOpencodeService,
		@Inject(OpencodeEventsInject.STREAM_SERVICE)
		private readonly opencodeEventStreamService: IOpencodeEventStreamService,

		private readonly eventEmitter: EventEmitter2
	) {}

	async abort(
		client: LinearClient,
		agentSessionId: string,
		issueId: string | undefined,
		message: string
	): Promise<void> {
		await this.linearService.abortDelegation(client, agentSessionId, issueId, message);
		await this.repository.updateStatus(agentSessionId, 'failed', message);
	}

	async processEvent(payload: AgentSessionEventWebhookPayload): Promise<void> {
		const {
			action,
			organizationId,
			agentSession: { id: agentSessionId },
		} = payload;
		this.logger.log('Processing agent session event', {
			action,
			agentSessionId,
			organizationId,
		});

		const { client, issue, issueId, issueTitle, repositoryName } =
			await this.validatorService.validateEvent(payload);

		const mode = action === 'created' ? 'delegation' : 'mention';

		const session = await this.repository.findOrCreateSession({
			agentSessionId,
			issueId,
			issueTitle,
			mode,
			organizationId,
			repositoryName,
		});

		await this.linearService.emitAgentActivity(client, agentSessionId, {
			body: `Created OpenCode session. ${session.openCodeSessionId}`,
			type: AgentActivityType.Thought,
		});

		await this.repository.updateStatus(agentSessionId, 'processing');

		const event = {
			agentSessionId,
			client,
			issue,
			issueId,
			issueTitle,
			mode,
			openCodeSessionId: session.openCodeSessionId,
			payload,
			repositoryName,
		};

		switch (action) {
			case 'created': {
				this.eventEmitter.emit('agent-session.created', event);
				break;
			}
			case 'prompted': {
				this.eventEmitter.emit('agent-session.prompted', event);
				break;
			}
		}
	}

	async handleCreated(event: AgentSessionCreatedEvent): Promise<void> {
		const { client, payload, agentSessionId, issue, issueId, openCodeSessionId, repositoryName } =
			event;

		const openSpecResult = this.validatorService.parseOpenSpecChange(issue.description ?? '');

		if (!openSpecResult.ok) {
			await this.abort(client, agentSessionId, issueId, openSpecResult.message);

			return;
		}

		await this.linearService.emitAgentActivity(client, agentSessionId, {
			body: 'Built the prompt. Starting implementation...',
			type: AgentActivityType.Thought,
		});

		const prompt = this.promptService.buildDelegationPrompt(payload, openSpecResult.change);

		await this.opencodeService.promptAsync(repositoryName, openCodeSessionId, prompt);

		await this.linearService.emitAgentActivity(client, agentSessionId, {
			body: 'Prompted the model asynchronously',
			type: AgentActivityType.Thought,
		});

		this.opencodeEventStreamService.ensureStream(repositoryName);
	}

	async handlePrompted(event: AgentSessionPromptedEvent): Promise<void> {
		const { client, payload, agentSessionId, openCodeSessionId, repositoryName } = event;

		await this.linearService.emitAgentActivity(client, agentSessionId, {
			body: 'Starting to process the question',
			type: AgentActivityType.Thought,
		});

		const prompt = this.promptService.buildMentionPrompt(payload);

		await this.opencodeService.promptAsync(
			repositoryName,
			openCodeSessionId,
			prompt,
			MENTION_READ_ONLY_TOOLS
		);

		this.opencodeEventStreamService.ensureStream(repositoryName);
	}
}
