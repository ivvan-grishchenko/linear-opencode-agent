import type { AgentSessionEventWebhookPayload } from '@linear/sdk';
import type { Mocked } from '@suites/unit';

import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionCreatedEvent, AgentSessionPromptedEvent } from '../agent-session.type';
import type { IAgentSessionEventProcessor } from '../interface';

import { AgentSessionInject } from '../agent-session.enum';
import { AgentSessionEventListener } from './agent-session.event.listener';

describe('agentSessionEventListener', () => {
	let listener: AgentSessionEventListener;
	let processor: Mocked<IAgentSessionEventProcessor>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(AgentSessionEventListener).compile();

		listener = unit;
		processor = unitRef.get(AgentSessionInject.PROCESSOR);
	});

	afterEach(() => vi.resetAllMocks());

	describe('handleAgentSessionEvent', () => {
		it('should delegate to processor.processEvent', async () => {
			const payload = { action: 'created' } as AgentSessionEventWebhookPayload;
			await processor.processEvent.mockResolvedValue();

			await listener.handleAgentSessionEvent(payload);

			expect(processor.processEvent).toHaveBeenCalledWith(payload);
		});

		it('should silently catch errors from processor', async () => {
			const payload = { action: 'created' } as AgentSessionEventWebhookPayload;
			await processor.processEvent.mockRejectedValue(new Error('fail'));

			await expect(listener.handleAgentSessionEvent(payload)).resolves.toBeUndefined();
		});
	});

	describe('handleCreated', () => {
		it('should delegate to processor.handleCreated', async () => {
			const event = { agentSessionId: 'session-1' } as AgentSessionCreatedEvent;
			await processor.handleCreated.mockResolvedValue();

			await listener.handleCreated(event);

			expect(processor.handleCreated).toHaveBeenCalledWith(event);
		});

		it('should catch and log errors from processor', async () => {
			const event = { agentSessionId: 'session-1' } as AgentSessionCreatedEvent;
			await processor.handleCreated.mockRejectedValue(new Error('fail'));

			await expect(listener.handleCreated(event)).resolves.toBeUndefined();
		});
	});

	describe('handlePrompted', () => {
		it('should delegate to processor.handlePrompted', async () => {
			const event = { agentSessionId: 'session-1' } as AgentSessionPromptedEvent;
			await processor.handlePrompted.mockResolvedValue();

			await listener.handlePrompted(event);

			expect(processor.handlePrompted).toHaveBeenCalledWith(event);
		});

		it('should silently catch errors from processor', async () => {
			const event = { agentSessionId: 'session-1' } as AgentSessionPromptedEvent;
			await processor.handlePrompted.mockRejectedValue(new Error('fail'));

			await expect(listener.handlePrompted(event)).resolves.toBeUndefined();
		});
	});
});
