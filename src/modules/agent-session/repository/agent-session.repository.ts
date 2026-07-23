import { agentSessions } from '@db/schema';
import { type DatabaseClient, DatabaseInject } from '@modules/database';
import { type IOpencodeService, OpencodeInject } from '@modules/opencode';
import { type IRepoMappingService, RepoMappingInject } from '@modules/repo-mapping';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { IAgentSessionRepository } from '../interface';

@Injectable()
export class AgentSessionRepository implements IAgentSessionRepository {
	constructor(
		@Inject(DatabaseInject.CLIENT)
		private readonly db: DatabaseClient,
		@Inject(OpencodeInject.SERVICE)
		private readonly opencodeService: IOpencodeService,
		@Inject(RepoMappingInject.SERVICE)
		private readonly repoMappingService: IRepoMappingService
	) {}

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

	async resolveRepositoryName(
		organizationId: string,
		projectId: string | null
	): Promise<string | null> {
		if (!projectId) return null;

		const mapping = await this.repoMappingService.findByOrganizationAndProject(
			organizationId,
			projectId
		);

		return mapping?.repositoryName ?? null;
	}

	async findOrCreateSession(params: {
		agentSessionId: string;
		issueId: string;
		issueTitle: string;
		mode: 'delegation' | 'mention';
		organizationId: string;
		repositoryName: string;
	}): Promise<{ openCodeBaseUrl: string; openCodeSessionId: string }> {
		const { agentSessionId, issueId, issueTitle, mode, organizationId, repositoryName } = params;

		const rows = await this.db
			.select()
			.from(agentSessions)
			.where(eq(agentSessions.agentSessionId, agentSessionId));

		const existing = rows.at(0);

		if (existing?.openCodeSessionId)
			return {
				openCodeBaseUrl:
					existing.openCodeBaseUrl ?? this.opencodeService.getBaseUrl(repositoryName),
				openCodeSessionId: existing.openCodeSessionId,
			};

		const openCodeSessionId = await this.opencodeService.createSession(repositoryName, issueTitle);
		const openCodeBaseUrl = this.opencodeService.getBaseUrl(repositoryName);
		const now = Date.now();

		await this.db
			.insert(agentSessions)
			.values({
				agentSessionId,
				createdAt: now,
				errorMessage: null,
				issueId,
				mode,
				openCodeBaseUrl,
				openCodeSessionId,
				organizationId,
				repositoryName,
				status: 'processing',
				updatedAt: now,
			})
			.onConflictDoUpdate({
				set: {
					mode,
					openCodeBaseUrl,
					openCodeSessionId,
					repositoryName,
					status: 'processing',
					updatedAt: now,
				},
				target: agentSessions.agentSessionId,
			});

		return { openCodeBaseUrl, openCodeSessionId };
	}
}
