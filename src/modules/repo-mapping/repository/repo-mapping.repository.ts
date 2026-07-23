import { repoMappings } from '@db/schema';
import { type DatabaseClient, DatabaseInject } from '@modules/database';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import type { RepoMappingResponse } from '../dto';
import type { IRepoMappingRepository } from '../interface';

@Injectable()
export class RepoMappingRepository implements IRepoMappingRepository {
	constructor(
		@Inject(DatabaseInject.CLIENT)
		private readonly db: DatabaseClient
	) {}

	async findAll(organizationId?: string): Promise<RepoMappingResponse[]> {
		if (organizationId)
			return this.db
				.select()
				.from(repoMappings)
				.where(eq(repoMappings.organizationId, organizationId));

		return this.db.select().from(repoMappings);
	}

	async findByOrganizationAndProject(
		organizationId: string,
		projectId: string
	): Promise<RepoMappingResponse | null> {
		const rows = await this.db
			.select()
			.from(repoMappings)
			.where(
				and(eq(repoMappings.organizationId, organizationId), eq(repoMappings.projectId, projectId))
			);

		return rows[0] ?? null;
	}

	async insert(row: RepoMappingResponse): Promise<void> {
		await this.db.insert(repoMappings).values(row);
	}

	async update(organizationId: string, projectId: string, repositoryName: string): Promise<void> {
		await this.db
			.update(repoMappings)
			.set({ repositoryName, updatedAt: Date.now() })
			.where(
				and(eq(repoMappings.organizationId, organizationId), eq(repoMappings.projectId, projectId))
			);
	}

	async delete(organizationId: string, projectId: string): Promise<void> {
		await this.db
			.delete(repoMappings)
			.where(
				and(eq(repoMappings.organizationId, organizationId), eq(repoMappings.projectId, projectId))
			);
	}
}
