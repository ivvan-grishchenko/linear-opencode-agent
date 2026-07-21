import { agentSessions } from '@db/schema';
import { AgentActivityType } from '@linear/sdk';
import { type DatabaseClient, DatabaseInject } from '@modules/database';
import { type ILinearService, LinearInject } from '@modules/linear';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import type { IOpencodeEventRepository } from '../interface';
import type { ResolvedSession } from '../opencode-events.type';

@Injectable()
export class OpencodeEventRepository implements IOpencodeEventRepository {
	constructor(
		@Inject(DatabaseInject.CLIENT)
		private readonly db: DatabaseClient,
		@Inject(LinearInject.SERVICE)
		private readonly linearService: ILinearService
	) {}

	async findSession(openCodeSessionId: string): Promise<ResolvedSession | null> {
		const rows = await this.db
			.select()
			.from(agentSessions)
			.where(eq(agentSessions.openCodeSessionId, openCodeSessionId));

		const session = rows.at(0);

		if (!session) return null;

		const client = await this.linearService.getClient(session.organizationId);

		if (!client) return null;

		return {
			agentSessionId: session.agentSessionId,
			client,
			mode: session.mode,
			openCodeSessionId: session.openCodeSessionId!,
			repositoryName: session.repositoryName!,
		};
	}

	async updateStatus(
		agentSessionId: string,
		status: 'queued' | 'processing' | 'completed' | 'failed',
		errorMessage?: string
	): Promise<void> {
		await this.db
			.update(agentSessions)
			.set({
				errorMessage: errorMessage ?? null,
				status,
				updatedAt: Date.now(),
			})
			.where(eq(agentSessions.agentSessionId, agentSessionId));
	}

	async markSessionsFailed(repositoryName: string, message: string): Promise<void> {
		const sessions = await this.db
			.select()
			.from(agentSessions)
			.where(
				and(
					eq(agentSessions.repositoryName, repositoryName),
					eq(agentSessions.status, 'processing')
				)
			);

		await Promise.all(
			sessions.map(async (session) => {
				const client = await this.linearService.getClient(session.organizationId);

				if (client)
					await this.linearService.emitAgentActivity(client, session.agentSessionId, {
						body: message,
						type: AgentActivityType.Error,
					});

				await this.updateStatus(session.agentSessionId, 'failed', message);
			})
		);
	}
}
