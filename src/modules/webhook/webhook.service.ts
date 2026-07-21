import type { AgentSessionEventWebhookPayload } from '@linear/sdk';
import type { DatabaseClient } from '@modules/database';

import { agentSessions } from '@db/schema';
import { DatabaseInject } from '@modules/database';
import { Inject, Injectable, Logger } from '@nestjs/common';
// oxlint-disable-next-line typescript/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';

import type { IWebhookService } from './webhook.service.interface';

@Injectable()
export class WebhookService implements IWebhookService {
	private readonly logger = new Logger(WebhookService.name);

	constructor(
		@Inject(DatabaseInject.CLIENT)
		private readonly db: DatabaseClient,

		private readonly eventEmitter: EventEmitter2
	) {}

	async handleAgentSessionPayload(payload: AgentSessionEventWebhookPayload): Promise<void> {
		const agentSessionId = payload.agentSession.id;

		this.logger.log('Received agent session event', {
			action: payload.action,
			agentSessionId,
		});

		const existingRows = await this.db
			.select()
			.from(agentSessions)
			.where(eq(agentSessions.agentSessionId, agentSessionId));

		const [existing] = existingRows;

		if (existing) {
			this.logger.log('Agent session already queued or processed', {
				agentSessionId,
				status: existing.status,
			});

			return;
		}

		const now = Date.now();

		try {
			await this.db.insert(agentSessions).values({
				agentSessionId,
				createdAt: now,
				errorMessage: null,
				issueId: payload.agentSession.issueId ?? null,
				mode: payload.action === 'created' ? 'delegation' : 'mention',
				openCodeBaseUrl: null,
				openCodeSessionId: null,
				organizationId: payload.organizationId,
				repositoryName: null,
				status: 'queued',
				updatedAt: now,
			});
		} catch (error) {
			this.logger.error('Failed to insert agent session marker', error);

			return;
		}

		this.eventEmitter.emit('agent-session.event', payload);
	}
}
