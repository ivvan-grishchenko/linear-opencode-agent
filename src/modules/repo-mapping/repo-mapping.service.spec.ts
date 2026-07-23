import type { Mocked } from '@suites/unit';

import { ConflictException, NotFoundException } from '@nestjs/common';
import { TestBed } from '@suites/unit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IRepoMappingRepository } from './interface';

import { RepoMappingInject } from './repo-mapping.enum';
import { RepoMappingService } from './repo-mapping.service';

describe('repoMappingService', () => {
	let service: RepoMappingService;
	let repository: Mocked<IRepoMappingRepository>;

	beforeEach(async () => {
		vi.clearAllMocks();

		const { unit, unitRef } = await TestBed.solitary(RepoMappingService).compile();

		service = unit;
		repository = unitRef.get(RepoMappingInject.REPOSITORY);
	});

	describe('create', () => {
		const input = {
			organizationId: 'org-1',
			projectId: 'proj-1',
			repositoryName: 'repo-1',
		};

		it('should throw ConflictException when mapping already exists', async () => {
			await repository.findByOrganizationAndProject.mockResolvedValue({
				createdAt: 1,
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'existing',
				updatedAt: 1,
			});

			await expect(service.create(input)).rejects.toThrow(ConflictException);
		});

		it('should insert and return the new row', async () => {
			await repository.findByOrganizationAndProject.mockResolvedValue(null);
			await repository.insert.mockResolvedValue(undefined);

			const result = await service.create(input);

			expect(result.organizationId).toBe('org-1');
			expect(result.projectId).toBe('proj-1');
			expect(result.repositoryName).toBe('repo-1');
			expect(repository.insert).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: 'org-1',
					projectId: 'proj-1',
					repositoryName: 'repo-1',
				})
			);
		});
	});

	describe('findByOrganizationAndProject', () => {
		it('should delegate to repository', async () => {
			const row = {
				createdAt: 1,
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
				updatedAt: 1,
			};
			await repository.findByOrganizationAndProject.mockResolvedValue(row);

			const result = await service.findByOrganizationAndProject('org-1', 'proj-1');

			expect(result).toBe(row);
			expect(repository.findByOrganizationAndProject).toHaveBeenCalledWith('org-1', 'proj-1');
		});
	});

	describe('list', () => {
		it('should delegate to repository without filter', async () => {
			const rows = [
				{
					createdAt: 1,
					organizationId: 'org-1',
					projectId: 'proj-1',
					repositoryName: 'r1',
					updatedAt: 1,
				},
			];
			await repository.findAll.mockResolvedValue(rows);

			const result = await service.list();

			expect(result).toBe(rows);
			expect(repository.findAll).toHaveBeenCalledWith(undefined);
		});

		it('should delegate to repository with filter', async () => {
			await repository.findAll.mockResolvedValue([]);

			await service.list('org-1');

			expect(repository.findAll).toHaveBeenCalledWith('org-1');
		});
	});

	describe('update', () => {
		const input = { repositoryName: 'new-repo' };

		it('should throw NotFoundException when mapping does not exist', async () => {
			await repository.findByOrganizationAndProject.mockResolvedValue(null);

			await expect(service.update('org-1', 'proj-1', input)).rejects.toThrow(NotFoundException);
		});

		it('should update and return the updated row', async () => {
			const existing = {
				createdAt: 1,
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'old-repo',
				updatedAt: 1,
			};
			await repository.findByOrganizationAndProject.mockResolvedValue(existing);
			await repository.update.mockResolvedValue(undefined);

			const result = await service.update('org-1', 'proj-1', input);

			expect(result.repositoryName).toBe('new-repo');
			expect(repository.update).toHaveBeenCalledWith('org-1', 'proj-1', 'new-repo');
		});
	});

	describe('delete', () => {
		it('should throw NotFoundException when mapping does not exist', async () => {
			await repository.findByOrganizationAndProject.mockResolvedValue(null);

			await expect(service.delete('org-1', 'proj-1')).rejects.toThrow(NotFoundException);
		});

		it('should delete the mapping when it exists', async () => {
			await repository.findByOrganizationAndProject.mockResolvedValue({
				createdAt: 1,
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
				updatedAt: 1,
			});
			await repository.delete.mockResolvedValue(undefined);

			await expect(service.delete('org-1', 'proj-1')).resolves.toBeUndefined();
			expect(repository.delete).toHaveBeenCalledWith('org-1', 'proj-1');
		});
	});
});
