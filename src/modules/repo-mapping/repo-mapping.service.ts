import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { CreateRepoMappingDto, RepoMappingResponse, UpdateRepoMappingDto } from './dto';
import type { IRepoMappingRepository, IRepoMappingService } from './interface';

import { RepoMappingInject } from './repo-mapping.enum';

@Injectable()
export class RepoMappingService implements IRepoMappingService {
	constructor(
		@Inject(RepoMappingInject.REPOSITORY)
		private readonly repository: IRepoMappingRepository
	) {}

	async create(input: CreateRepoMappingDto): Promise<RepoMappingResponse> {
		const existing = await this.repository.findByOrganizationAndProject(
			input.organizationId,
			input.projectId
		);

		if (existing)
			throw new ConflictException(
				`Repo mapping for organizationId=${input.organizationId}, projectId=${input.projectId} already exists`
			);

		const now = Date.now();
		const row: RepoMappingResponse = {
			createdAt: now,
			organizationId: input.organizationId,
			projectId: input.projectId,
			repositoryName: input.repositoryName,
			updatedAt: now,
		};

		await this.repository.insert(row);

		return row;
	}

	async delete(organizationId: string, projectId: string): Promise<void> {
		const existing = await this.repository.findByOrganizationAndProject(organizationId, projectId);

		if (!existing)
			throw new NotFoundException(
				`Repo mapping for organizationId=${organizationId}, projectId=${projectId} not found`
			);

		await this.repository.delete(organizationId, projectId);
	}

	async findByOrganizationAndProject(
		organizationId: string,
		projectId: string
	): Promise<RepoMappingResponse | null> {
		return this.repository.findByOrganizationAndProject(organizationId, projectId);
	}

	async list(organizationId?: string): Promise<RepoMappingResponse[]> {
		return this.repository.findAll(organizationId);
	}

	async update(
		organizationId: string,
		projectId: string,
		input: UpdateRepoMappingDto
	): Promise<RepoMappingResponse> {
		const existing = await this.repository.findByOrganizationAndProject(organizationId, projectId);

		if (!existing)
			throw new NotFoundException(
				`Repo mapping for organizationId=${organizationId}, projectId=${projectId} not found`
			);

		await this.repository.update(organizationId, projectId, input.repositoryName);

		return { ...existing, repositoryName: input.repositoryName, updatedAt: Date.now() };
	}
}
