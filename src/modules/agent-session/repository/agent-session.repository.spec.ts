import type { ResultSet } from '@libsql/client';
import type { DatabaseClient } from '@modules/database';
import type { IOpencodeService } from '@modules/opencode';
import type { Mocked } from '@suites/unit';
import type { ChainMock } from 'chain-mock';

import { agentSessions, repoMappings } from '@db/schema';
import { DatabaseInject } from '@modules/database';
import { OpencodeInject } from '@modules/opencode';
import { TestBed } from '@suites/unit';
import { chainMock } from 'chain-mock';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionRepository } from './agent-session.repository';

describe('agentSessionRepository', () => {
	let repository: AgentSessionRepository;
	let db: ChainMock<DatabaseClient>;
	let opencodeService: Mocked<IOpencodeService>;

	beforeEach(async () => {
		vi.clearAllMocks();
		db = chainMock<DatabaseClient>();

		const { unit, unitRef } = await TestBed.solitary(AgentSessionRepository)
			.mock(DatabaseInject.CLIENT)
			.impl(() => db)
			.compile();

		repository = unit;
		opencodeService = unitRef.get(OpencodeInject.SERVICE);
	});

	afterEach(() => vi.resetAllMocks());

	describe('updateStatus', () => {
		it('should execute proper db query when errorMessage is undefined', async () => {
			const agentSessionId = 'agent-session-id';
			const status = 'queued';

			await db.update.set.where.mockResolvedValue({} as ResultSet);

			await expect(repository.updateStatus(agentSessionId, status)).resolves.toBeUndefined();
			expect(db.update.set.where).toHaveBeenChainCalledWith(
				[agentSessions],
				[expect.objectContaining({ errorMessage: null, status })],
				[eq(agentSessions.agentSessionId, agentSessionId)]
			);
		});

		it('should execute proper db query when errorMessage defined', async () => {
			const agentSessionId = 'agent-session-id';
			const status = 'queued';
			const errorMessage = 'error';

			await db.update.set.where.mockResolvedValue({} as ResultSet);

			await expect(
				repository.updateStatus(agentSessionId, status, errorMessage)
			).resolves.toBeUndefined();
			expect(db.update.set.where).toHaveBeenChainCalledWith(
				[agentSessions],
				[expect.objectContaining({ errorMessage: 'error', status })],
				[eq(agentSessions.agentSessionId, agentSessionId)]
			);
		});
	});

	describe('resolveRepositoryName', () => {
		it('should return early when no project id', async () => {
			const result = await repository.resolveRepositoryName('org-1', null);

			expect(result).toBeNull();
		});

		it('should return null when no repository found', async () => {
			await db.select.from.where.mockResolvedValue([]);

			const result = await repository.resolveRepositoryName('org-1', 'proj-1');

			expect(result).toBeNull();
			expect(db.select.from.where).toHaveBeenChainCalledWith(
				[{ repositoryName: repoMappings.repositoryName }],
				[repoMappings],
				[and(eq(repoMappings.organizationId, 'org-1'), eq(repoMappings.projectId, 'proj-1'))]
			);
		});

		it('should return repository name when repository is found', async () => {
			await db.select.from.where.mockResolvedValue([{ repositoryName: 'repo' }]);

			const result = await repository.resolveRepositoryName('org-1', 'proj-1');

			expect(result).toBe('repo');
			expect(db.select.from.where).toHaveBeenChainCalledWith(
				[{ repositoryName: repoMappings.repositoryName }],
				[repoMappings],
				[and(eq(repoMappings.organizationId, 'org-1'), eq(repoMappings.projectId, 'proj-1'))]
			);
		});
	});

	describe('findOrCreateSession', () => {
		const params = {
			agentSessionId: 'agent-session-id',
			issueId: 'issue-id',
			issueTitle: 'title',
			mode: 'delegation' as const,
			organizationId: 'org-1',
			repositoryName: 'repo',
		};

		describe('when db finds an existing session', () => {
			it('should return correct response when base url exists', async () => {
				await db.select.from.where.mockResolvedValue([
					{ openCodeBaseUrl: 'https://example.com', openCodeSessionId: 'session-1' },
				]);

				const result = await repository.findOrCreateSession(params);

				expect(result).toStrictEqual({
					openCodeBaseUrl: 'https://example.com',
					openCodeSessionId: 'session-1',
				});
				expect(db.select.from.where).toHaveBeenChainCalledWith(
					[],
					[agentSessions],
					[eq(agentSessions.agentSessionId, params.agentSessionId)]
				);
			});

			it('should return correct response when base url does not exist', async () => {
				await db.select.from.where.mockResolvedValue([{ openCodeSessionId: 'session-1' }]);
				opencodeService.getBaseUrl.mockReturnValue('https://example.com');

				const result = await repository.findOrCreateSession(params);

				expect(result).toStrictEqual({
					openCodeBaseUrl: 'https://example.com',
					openCodeSessionId: 'session-1',
				});
				expect(opencodeService.getBaseUrl).toHaveBeenCalledWith(params.repositoryName);
				expect(db.select.from.where).toHaveBeenChainCalledWith(
					[],
					[agentSessions],
					[eq(agentSessions.agentSessionId, params.agentSessionId)]
				);
			});
		});

		describe('when db fails to find existing session', () => {
			beforeEach(async () => {
				await db.select.from.where.mockResolvedValue([]);
			});

			it('should return correct response', async () => {
				await opencodeService.createSession.mockResolvedValue('session-1');
				opencodeService.getBaseUrl.mockReturnValue('https://example.com');
				await db.insert.values.onConflictDoUpdate.mockResolvedValue({} as ResultSet);

				const response = await repository.findOrCreateSession(params);

				expect(response).toStrictEqual({
					openCodeBaseUrl: 'https://example.com',
					openCodeSessionId: 'session-1',
				});
				expect(opencodeService.createSession).toHaveBeenCalledWith(
					params.repositoryName,
					params.issueTitle
				);
				expect(opencodeService.getBaseUrl).toHaveBeenCalledWith(params.repositoryName);
			});
		});
	});
});
