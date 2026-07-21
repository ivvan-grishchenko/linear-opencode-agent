import type { AgentSessionEventWebhookPayload } from '@linear/sdk';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { AgentSessionCreatedEvent, AgentSessionPromptedEvent } from '../agent-session.type';
import type { IAgentSessionEventProcessor } from '../interface';

import { AgentSessionInject } from '../agent-session.enum';

@Injectable()
export class AgentSessionEventListener {
	private readonly logger = new Logger(AgentSessionEventListener.name);

	constructor(
		@Inject(AgentSessionInject.PROCESSOR)
		private readonly processor: IAgentSessionEventProcessor
	) {}

	@OnEvent('agent-session.event', { async: true })
	async handleAgentSessionEvent(payload: AgentSessionEventWebhookPayload): Promise<void> {
		try {
			await this.processor.processEvent(payload);
		} catch {
			// The processor logs its own errors.
		}
	}

	@OnEvent('agent-session.created', { async: true })
	async handleCreated(event: AgentSessionCreatedEvent): Promise<void> {
		this.logger.log('Received agent session event', event);
		try {
			await this.processor.handleCreated(event);
		} catch (error) {
			this.logger.error('Caught error', error);
			// The processor logs its own errors.
		}
	}

	@OnEvent('agent-session.prompted', { async: true })
	async handlePrompted(event: AgentSessionPromptedEvent): Promise<void> {
		try {
			await this.processor.handlePrompted(event);
		} catch {
			// The processor logs its own errors.
		}
	}
}
