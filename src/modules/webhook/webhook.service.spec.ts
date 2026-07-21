import type { ResultSet } from '@libsql/client';
import type { AgentSessionEventWebhookPayload, AgentSessionWebhookPayload } from '@linear/sdk';
import type { DatabaseClient } from '@modules/database';
import type { Mocked } from '@suites/unit';

import { agentSessions } from '@db/schema';
import { DatabaseInject } from '@modules/database';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TestBed } from '@suites/unit';
import { type ChainMock, chainMock } from 'chain-mock';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebhookService } from './webhook.service';

describe('webhookService', () => {
	let webhookService: WebhookService;
	let eventEmitter: Mocked<EventEmitter2>;
	let db: ChainMock<DatabaseClient>;

	beforeEach(async () => {
		db = chainMock<DatabaseClient>();

		const { unit, unitRef } = await TestBed.solitary(WebhookService)
			.mock(DatabaseInject.CLIENT)
			.impl(() => db)
			.compile();

		webhookService = unit;
		eventEmitter = unitRef.get(EventEmitter2);
	});

	afterEach(() => vi.resetAllMocks());

	it('should return early when record already exists', async () => {
		const payload: AgentSessionEventWebhookPayload = {
			agentSession: { id: 'agent-session-id' } as AgentSessionWebhookPayload,
		} as AgentSessionEventWebhookPayload;
		db.select.from.where.mockResolvedValueOnce([
			{ agentSessionId: 'agent-session-id', status: 'queued' },
		]);

		await webhookService.handleAgentSessionPayload(payload);

		expect(db.select.from.where).toHaveBeenChainCalledWith(
			[],
			[agentSessions],
			[eq(agentSessions.agentSessionId, 'agent-session-id')]
		);
		expect(eventEmitter.emit).not.toHaveBeenCalled();
	});

	describe('record does not exist', () => {
		let payload: AgentSessionEventWebhookPayload;

		beforeEach(() => {
			payload = {
				action: 'created',
				agentSession: {
					id: 'agent-session-id',
					issueId: 'issue-1',
				} as AgentSessionWebhookPayload,
				organizationId: 'organization-1',
			} as AgentSessionEventWebhookPayload;
			db.select.from.where.mockResolvedValue([]);
		});

		it('should not emit event when insertion fails', async () => {
			db.insert.values.mockRejectedValue('Insertion failed');

			await webhookService.handleAgentSessionPayload(payload);

			expect(eventEmitter.emit).not.toHaveBeenCalled();
			expect(db.insert.values).toHaveBeenChainCalledWith(
				[agentSessions],
				[
					expect.objectContaining({
						agentSessionId: payload.agentSession.id,
						issueId: payload.agentSession.issueId,
						mode: 'delegation',
						organizationId: payload.organizationId,
						status: 'queued',
					}),
				]
			);
		});

		it('should emit event when insertion succeeds', async () => {
			db.insert.values.mockResolvedValue({} as ResultSet);

			await webhookService.handleAgentSessionPayload(payload);

			expect(eventEmitter.emit).toHaveBeenCalledWith('agent-session.event', payload);
		});

		it('should insert record with null issueId when it does not exist in payload', async () => {
			// oxlint-disable-next-line typescript/no-misused-spread
			payload = { ...payload, agentSession: { ...payload.agentSession, issueId: null } };

			db.insert.values.mockResolvedValue({} as ResultSet);

			await webhookService.handleAgentSessionPayload(payload);

			expect(db.insert.values).toHaveBeenChainCalledWith(
				[agentSessions],
				[
					expect.objectContaining({
						agentSessionId: payload.agentSession.id,
						issueId: null,
						mode: 'delegation',
						organizationId: payload.organizationId,
						status: 'queued',
					}),
				]
			);
			expect(eventEmitter.emit).toHaveBeenCalledWith('agent-session.event', payload);
		});

		it('should insert record with mention mode when payload action differs from created', async () => {
			// oxlint-disable-next-line typescript/no-misused-spread
			payload = { ...payload, action: 'prompted' };

			db.insert.values.mockResolvedValue({} as ResultSet);

			await webhookService.handleAgentSessionPayload(payload);

			expect(db.insert.values).toHaveBeenChainCalledWith(
				[agentSessions],
				[
					expect.objectContaining({
						agentSessionId: payload.agentSession.id,
						issueId: payload.agentSession.issueId,
						mode: 'mention',
						organizationId: payload.organizationId,
						status: 'queued',
					}),
				]
			);
			expect(eventEmitter.emit).toHaveBeenCalledWith('agent-session.event', payload);
		});
	});
});
