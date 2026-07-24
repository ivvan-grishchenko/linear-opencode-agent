import type { Mocked } from '@suites/unit';

import { NotFoundException } from '@nestjs/common';
import { TestBed } from '@suites/unit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IRepoMappingService } from './interface';

import { RepoMappingController } from './repo-mapping.controller';
import { RepoMappingInject } from './repo-mapping.enum';

describe('repoMappingController', () => {
	let controller: RepoMappingController;
	let service: Mocked<IRepoMappingService>;

	beforeEach(async () => {
		vi.clearAllMocks();

		const { unit, unitRef } = await TestBed.solitary(RepoMappingController).compile();

		controller = unit;
		service = unitRef.get(RepoMappingInject.SERVICE);
	});

	describe('list', () => {
		it('should delegate to service without filter', async () => {
			await service.list.mockResolvedValue([]);

			await controller.list();

			expect(service.list).toHaveBeenCalledWith(undefined);
		});

		it('should delegate to service with filter', async () => {
			await service.list.mockResolvedValue([]);

			await controller.list('org-1');

			expect(service.list).toHaveBeenCalledWith('org-1');
		});
	});

	describe('findByOrganizationAndProject', () => {
		it('should throw NotFoundException when mapping is not found', async () => {
			await service.findByOrganizationAndProject.mockResolvedValue(null);

			await expect(controller.findByOrganizationAndProject('org-1', 'proj-1')).rejects.toThrow(
				NotFoundException
			);
		});

		it('should return the mapping when found', async () => {
			const mapping = {
				createdAt: 1,
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
				updatedAt: 1,
			};
			await service.findByOrganizationAndProject.mockResolvedValue(mapping);

			const result = await controller.findByOrganizationAndProject('org-1', 'proj-1');

			expect(result).toBe(mapping);
		});
	});

	describe('create', () => {
		it('should delegate body to service', async () => {
			const mapping = {
				createdAt: 1,
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
				updatedAt: 1,
			};
			await service.create.mockResolvedValue(mapping);

			const result = await controller.create({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});

			expect(result).toBe(mapping);
			expect(service.create).toHaveBeenCalledWith({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});
		});
	});

	describe('update', () => {
		it('should delegate body to service', async () => {
			const mapping = {
				createdAt: 1,
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'new-repo',
				updatedAt: 2,
			};
			await service.update.mockResolvedValue(mapping);

			const result = await controller.update('org-1', 'proj-1', { repositoryName: 'new-repo' });

			expect(result).toBe(mapping);
			expect(service.update).toHaveBeenCalledWith('org-1', 'proj-1', {
				repositoryName: 'new-repo',
			});
		});
	});

	describe('delete', () => {
		it('should delegate to service', async () => {
			await service.delete.mockResolvedValue(undefined);

			await controller.delete('org-1', 'proj-1');

			expect(service.delete).toHaveBeenCalledWith('org-1', 'proj-1');
		});
	});
});
