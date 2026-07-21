import type { ResultSet } from '@libsql/client';
import type { LinearClient } from '@linear/sdk';
import type { DatabaseClient } from '@modules/database';
import type { ILinearService } from '@modules/linear';
import type { Mocked } from '@suites/unit';
import type { ChainMock } from 'chain-mock';

import { agentSessions } from '@db/schema';
import { AgentActivityType } from '@linear/sdk';
import { DatabaseInject } from '@modules/database';
import { LinearInject } from '@modules/linear';
import { TestBed } from '@suites/unit';
import { chainMock } from 'chain-mock';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpencodeEventRepository } from './opencode.event.repository';

describe('opencodeEventRepository', () => {
	let repository: OpencodeEventRepository;
	let db: ChainMock<DatabaseClient>;
	let linearService: Mocked<ILinearService>;

	beforeEach(async () => {
		db = chainMock<DatabaseClient>();

		const { unit, unitRef } = await TestBed.solitary(OpencodeEventRepository)
			.mock(DatabaseInject.CLIENT)
			.impl(() => db)
			.compile();

		repository = unit;
		linearService = unitRef.get(LinearInject.SERVICE);
	});

	afterEach(() => vi.resetAllMocks());

	describe('findSession', () => {
		it('should return null when no session found', async () => {
			const openCodeSessionId = 'session-id';
			db.select.from.where.mockResolvedValue([]);

			const result = await repository.findSession(openCodeSessionId);

			expect(result).toBeNull();
			expect(db.select.from.where).toHaveBeenChainCalledWith(
				[],
				[agentSessions],
				[eq(agentSessions.openCodeSessionId, openCodeSessionId)]
			);
			expect(linearService.getClient).not.toHaveBeenCalled();
		});

		it('should return null when linear fails to create a client', async () => {
			const openCodeSessionId = 'session-id';
			const session = {
				agentSessionId: 'agent-session-id',
				mode: 'delegation',
				openCodeSessionId,
				organizationId: 'org-1',
				repositoryName: 'repository',
			};

			db.select.from.where.mockResolvedValue([session]);
			await linearService.getClient.mockResolvedValue(null);

			const result = await repository.findSession(openCodeSessionId);

			expect(result).toBeNull();
		});

		it('should return resolved session', async () => {
			const openCodeSessionId = 'session-id';
			const session = {
				agentSessionId: 'agent-session-id',
				mode: 'delegation',
				openCodeSessionId,
				organizationId: 'org-1',
				repositoryName: 'repository',
			};
			const linearClient = {} as LinearClient;

			db.select.from.where.mockResolvedValue([session]);
			await linearService.getClient.mockResolvedValue(linearClient);

			const result = await repository.findSession(openCodeSessionId);

			expect(result).toStrictEqual({
				agentSessionId: session.agentSessionId,
				client: linearClient,
				mode: session.mode,
				openCodeSessionId: session.openCodeSessionId,
				repositoryName: session.repositoryName,
			});
		});
	});

	describe('updateStatus', () => {
		it('should update session status without error message', async () => {
			db.update.set.where.mockResolvedValue({} as ResultSet);

			await repository.updateStatus('session-1', 'completed');

			expect(db.update.set.where).toHaveBeenChainCalledWith(
				[agentSessions],
				[{ errorMessage: null, status: 'completed', updatedAt: expect.any(Number) }],
				[eq(agentSessions.agentSessionId, 'session-1')]
			);
		});

		it('should update session status with error message', async () => {
			db.update.set.where.mockResolvedValue({} as ResultSet);

			await repository.updateStatus('session-1', 'failed', 'Something went wrong');

			expect(db.update.set.where).toHaveBeenChainCalledWith(
				[agentSessions],
				[
					{
						errorMessage: 'Something went wrong',
						status: 'failed',
						updatedAt: expect.any(Number),
					},
				],
				[eq(agentSessions.agentSessionId, 'session-1')]
			);
		});
	});

	describe('markSessionsFailed', () => {
		it('should emit error activity and mark sessions as failed when client exists', async () => {
			const linearClient = {} as LinearClient;
			db.select.from.where.mockResolvedValueOnce([
				{
					agentSessionId: 'session-1',
					organizationId: 'org-1',
				},
				{
					agentSessionId: 'session-2',
					organizationId: 'org-2',
				},
			]);
			db.update.set.where.mockResolvedValue({} as ResultSet);
			await linearService.getClient.mockResolvedValue(linearClient);

			await repository.markSessionsFailed('test-repo', 'Stream error');

			expect(linearService.emitAgentActivity).toHaveBeenCalledTimes(2);
			expect(linearService.emitAgentActivity).toHaveBeenCalledWith(linearClient, 'session-1', {
				body: 'Stream error',
				type: AgentActivityType.Error,
			});
			expect(linearService.emitAgentActivity).toHaveBeenCalledWith(linearClient, 'session-2', {
				body: 'Stream error',
				type: AgentActivityType.Error,
			});
			expect(db.update.set.where).toHaveBeenCalledTimes(2);
		});

		it('should mark sessions as failed even when client is unavailable', async () => {
			db.select.from.where.mockResolvedValueOnce([
				{
					agentSessionId: 'session-1',
					organizationId: 'org-1',
				},
			]);
			db.update.set.where.mockResolvedValue({} as ResultSet);
			await linearService.getClient.mockResolvedValue(null);

			await repository.markSessionsFailed('test-repo', 'Stream error');

			expect(linearService.emitAgentActivity).not.toHaveBeenCalled();
			expect(db.update.set.where).toHaveBeenCalledTimes(1);
		});

		it('should do nothing when no processing sessions are found', async () => {
			db.select.from.where.mockResolvedValueOnce([]);

			await repository.markSessionsFailed('test-repo', 'Stream error');

			expect(linearService.emitAgentActivity).not.toHaveBeenCalled();
			expect(db.update.set.where).not.toHaveBeenCalled();
		});
	});
});
