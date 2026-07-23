import type { ResultSet } from '@libsql/client';
import type { DatabaseClient } from '@modules/database';
import type { ChainMock } from 'chain-mock';

import { repoMappings } from '@db/schema';
import { DatabaseInject } from '@modules/database';
import { TestBed } from '@suites/unit';
import { chainMock } from 'chain-mock';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RepoMappingRepository } from './repo-mapping.repository';

describe('repoMappingRepository', () => {
	let repository: RepoMappingRepository;
	let db: ChainMock<DatabaseClient>;

	beforeEach(async () => {
		vi.clearAllMocks();
		db = chainMock<DatabaseClient>();

		const { unit } = await TestBed.solitary(RepoMappingRepository)
			.mock(DatabaseInject.CLIENT)
			.impl(() => db)
			.compile();

		repository = unit;
	});

	afterEach(() => vi.resetAllMocks());

	describe('findAll', () => {
		it('should return all rows when no organizationId is provided', async () => {
			const expected = [
				{
					createdAt: 1,
					organizationId: 'org-1',
					projectId: 'proj-1',
					repositoryName: 'repo-1',
					updatedAt: 1,
				},
			];
			// @ts-ignore
			await db.select.from.mockResolvedValue(expected);

			const result = await repository.findAll();

			expect(result).toBe(expected);
			expect(db.select.from).toHaveBeenChainCalledWith([], [repoMappings]);
		});

		it('should filter by organizationId when provided', async () => {
			const expected = [
				{
					createdAt: 1,
					organizationId: 'org-1',
					projectId: 'proj-1',
					repositoryName: 'repo-1',
					updatedAt: 1,
				},
			];
			await db.select.from.where.mockResolvedValue(expected);

			const result = await repository.findAll('org-1');

			expect(result).toBe(expected);
			expect(db.select.from.where).toHaveBeenChainCalledWith(
				[],
				[repoMappings],
				[eq(repoMappings.organizationId, 'org-1')]
			);
		});
	});

	describe('findByOrganizationAndProject', () => {
		it('should return null when no row is found', async () => {
			await db.select.from.where.mockResolvedValue([]);

			const result = await repository.findByOrganizationAndProject('org-1', 'proj-1');

			expect(result).toBeNull();
			expect(db.select.from.where).toHaveBeenChainCalledWith(
				[],
				[repoMappings],
				[and(eq(repoMappings.organizationId, 'org-1'), eq(repoMappings.projectId, 'proj-1'))]
			);
		});

		it('should return the row when found', async () => {
			const row = {
				createdAt: 1,
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
				updatedAt: 1,
			};
			await db.select.from.where.mockResolvedValue([row]);

			const result = await repository.findByOrganizationAndProject('org-1', 'proj-1');

			expect(result).toBe(row);
		});
	});

	describe('insert', () => {
		it('should insert the row', async () => {
			await db.insert.values.mockResolvedValue({} as ResultSet);
			const row = {
				createdAt: 1,
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
				updatedAt: 1,
			};

			await expect(repository.insert(row)).resolves.toBeUndefined();
			expect(db.insert.values).toHaveBeenChainCalledWith([repoMappings], [row]);
		});
	});

	describe('update', () => {
		it('should update repositoryName and updatedAt', async () => {
			await db.update.set.where.mockResolvedValue({} as ResultSet);

			await expect(repository.update('org-1', 'proj-1', 'new-repo')).resolves.toBeUndefined();
			expect(db.update.set.where).toHaveBeenChainCalledWith(
				[repoMappings],
				[expect.objectContaining({ repositoryName: 'new-repo' })],
				[and(eq(repoMappings.organizationId, 'org-1'), eq(repoMappings.projectId, 'proj-1'))]
			);
		});
	});

	describe('delete', () => {
		it('should delete the matching row', async () => {
			await db.delete.where.mockResolvedValue({} as ResultSet);

			await expect(repository.delete('org-1', 'proj-1')).resolves.toBeUndefined();
			expect(db.delete.where).toHaveBeenChainCalledWith(
				[repoMappings],
				[and(eq(repoMappings.organizationId, 'org-1'), eq(repoMappings.projectId, 'proj-1'))]
			);
		});
	});
});
