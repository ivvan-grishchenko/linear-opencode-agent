import type { AgentSessionEventWebhookPayload, Issue, LinearClient } from '@linear/sdk';
import type { ILinearService } from '@modules/linear';
import type { IOpencodeService } from '@modules/opencode';
import type { IOpencodeEventStreamService } from '@modules/opencode-events';
import type { Mocked } from '@suites/unit';

import { AgentActivityType } from '@linear/sdk';
import { LinearInject } from '@modules/linear';
import { OpencodeInject } from '@modules/opencode';
import { OpencodeEventsInject } from '@modules/opencode-events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionCreatedEvent, AgentSessionPromptedEvent } from '../agent-session.type';
import type {
	IAgentSessionPromptService,
	IAgentSessionRepository,
	IAgentSessionValidatorService,
} from '../interface';

import { MENTION_READ_ONLY_TOOLS } from '../agent-session.constant';
import { AgentSessionInject } from '../agent-session.enum';
import { AgentSessionEventProcessor } from './agent-session.event.processor';

describe('agentSessionEventProcessor', () => {
	let processor: AgentSessionEventProcessor;
	let validatorService: Mocked<IAgentSessionValidatorService>;
	let repository: Mocked<IAgentSessionRepository>;
	let promptService: Mocked<IAgentSessionPromptService>;
	let linearService: Mocked<ILinearService>;
	let opencodeService: Mocked<IOpencodeService>;
	let opencodeEventStreamService: Mocked<IOpencodeEventStreamService>;
	let eventEmitter: Mocked<EventEmitter2>;

	beforeEach(async () => {
		vi.clearAllMocks();
		const { unit, unitRef } = await TestBed.solitary(AgentSessionEventProcessor).compile();

		processor = unit;
		validatorService = unitRef.get(AgentSessionInject.VALIDATOR_SERVICE);
		repository = unitRef.get(AgentSessionInject.REPOSITORY);
		promptService = unitRef.get(AgentSessionInject.PROMPT_SERVICE);
		linearService = unitRef.get(LinearInject.SERVICE);
		opencodeService = unitRef.get(OpencodeInject.SERVICE);
		opencodeEventStreamService = unitRef.get(OpencodeEventsInject.STREAM_SERVICE);
		eventEmitter = unitRef.get(EventEmitter2);
	});

	afterEach(() => vi.resetAllMocks());

	describe('abort', () => {
		it('should call linearService.abortDelegation and repository.updateStatus', async () => {
			const client = {} as LinearClient;
			await linearService.abortDelegation.mockResolvedValue();
			await repository.updateStatus.mockResolvedValue();

			await processor.abort(client, 'session-1', 'issue-1', 'error message');

			expect(linearService.abortDelegation).toHaveBeenCalledWith(
				client,
				'session-1',
				'issue-1',
				'error message'
			);
			expect(repository.updateStatus).toHaveBeenCalledWith('session-1', 'failed', 'error message');
		});

		it('should handle undefined issueId', async () => {
			const client = {} as LinearClient;
			await linearService.abortDelegation.mockResolvedValue();
			await repository.updateStatus.mockResolvedValue();

			await processor.abort(client, 'session-1', undefined, 'error');

			expect(linearService.abortDelegation).toHaveBeenCalledWith(
				client,
				'session-1',
				undefined,
				'error'
			);
		});
	});

	describe('processEvent', () => {
		const client = {} as LinearClient;
		const issue = { description: 'desc' } as Issue;
		const validateResult = {
			client,
			issue,
			issueId: 'issue-1',
			issueTitle: 'title',
			repositoryName: 'repo',
		};
		const sessionResult = {
			openCodeBaseUrl: 'https://example.com',
			openCodeSessionId: 'session-1',
		};

		beforeEach(async () => {
			await validatorService.validateEvent.mockResolvedValue(validateResult);
			await repository.findOrCreateSession.mockResolvedValue(sessionResult);
			await linearService.emitAgentActivity.mockResolvedValue();
			await repository.updateStatus.mockResolvedValue();
		});

		it('should validate the event and find/create session for created action', async () => {
			const payload = {
				action: 'created',
				agentSession: { id: 'session-1' },
				organizationId: 'org-1',
			} as AgentSessionEventWebhookPayload;

			await processor.processEvent(payload);

			expect(validatorService.validateEvent).toHaveBeenCalledWith(payload);
			expect(repository.findOrCreateSession).toHaveBeenCalledWith({
				agentSessionId: 'session-1',
				issueId: 'issue-1',
				issueTitle: 'title',
				mode: 'delegation',
				organizationId: 'org-1',
				repositoryName: 'repo',
			});
		});

		it('should validate the event and find/create session for prompted action', async () => {
			const payload = {
				action: 'prompted',
				agentSession: { id: 'session-1' },
				organizationId: 'org-1',
			} as AgentSessionEventWebhookPayload;

			await processor.processEvent(payload);

			expect(repository.findOrCreateSession).toHaveBeenCalledWith(
				expect.objectContaining({ mode: 'mention' })
			);
		});

		it('should emit agent activity and update status', async () => {
			const payload = {
				action: 'created',
				agentSession: { id: 'session-1' },
				organizationId: 'org-1',
			} as AgentSessionEventWebhookPayload;

			await processor.processEvent(payload);

			expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
				client,
				'session-1',
				expect.objectContaining({
					body: expect.stringContaining('Created OpenCode session'),
					type: AgentActivityType.Thought,
				})
			);
			expect(repository.updateStatus).toHaveBeenCalledWith('session-1', 'processing');
		});

		it('should emit agent-session.created event when action is created', async () => {
			const payload = {
				action: 'created',
				agentSession: { id: 'session-1' },
				organizationId: 'org-1',
			} as AgentSessionEventWebhookPayload;

			await processor.processEvent(payload);

			expect(eventEmitter.emit).toHaveBeenCalledWith(
				'agent-session.created',
				expect.objectContaining({
					agentSessionId: 'session-1',
					client,
					issue,
					issueId: 'issue-1',
					issueTitle: 'title',
					mode: 'delegation',
					openCodeSessionId: 'session-1',
					payload,
					repositoryName: 'repo',
				})
			);
		});

		it('should emit agent-session.prompted event when action is prompted', async () => {
			const payload = {
				action: 'prompted',
				agentSession: { id: 'session-1' },
				organizationId: 'org-1',
			} as AgentSessionEventWebhookPayload;

			await processor.processEvent(payload);

			expect(eventEmitter.emit).toHaveBeenCalledWith(
				'agent-session.prompted',
				expect.objectContaining({
					mode: 'mention',
				})
			);
		});

		it('should propagate error when validation fails', async () => {
			const payload = {
				action: 'created',
				agentSession: { id: 'session-1' },
				organizationId: 'org-1',
			} as AgentSessionEventWebhookPayload;
			await validatorService.validateEvent.mockRejectedValue(new Error('validation failed'));

			await expect(processor.processEvent(payload)).rejects.toThrow('validation failed');
		});
	});

	describe('handleCreated', () => {
		const client = {} as LinearClient;
		const issue = { description: '<!-- openspec-change: test -->' } as Issue;
		const payload = {} as AgentSessionEventWebhookPayload;
		const event = {
			agentSessionId: 'session-1',
			client,
			issue,
			issueId: 'issue-1',
			issueTitle: 'title',
			mode: 'delegation' as const,
			openCodeSessionId: 'oc-session-1',
			payload,
			repositoryName: 'repo',
		} as AgentSessionCreatedEvent;

		beforeEach(async () => {
			await linearService.emitAgentActivity.mockResolvedValue();
			await opencodeService.promptAsync.mockResolvedValue();
			opencodeEventStreamService.ensureStream.mockReturnValue();
		});

		describe('when openspec change is missing', () => {
			beforeEach(async () => {
				validatorService.parseOpenSpecChange.mockReturnValue({
					message: 'No marker found',
					ok: false as const,
					reason: 'missing-marker',
				});
				await linearService.abortDelegation.mockResolvedValue();
				await repository.updateStatus.mockResolvedValue();
			});

			it('should abort the session', async () => {
				await processor.handleCreated(event);

				expect(validatorService.parseOpenSpecChange).toHaveBeenCalledWith(issue.description);
				expect(linearService.abortDelegation).toHaveBeenCalledWith(
					client,
					'session-1',
					'issue-1',
					'No marker found'
				);
				expect(repository.updateStatus).toHaveBeenCalledWith(
					'session-1',
					'failed',
					'No marker found'
				);
			});

			it('should not proceed with delegation', async () => {
				await processor.handleCreated(event);

				expect(promptService.buildDelegationPrompt).not.toHaveBeenCalled();
				expect(opencodeService.promptAsync).not.toHaveBeenCalled();
			});
		});

		describe('when openspec change is present', () => {
			const change = {
				branchName: 'feat/test',
				directoryPath: 'openspec/changes/test',
				name: 'test',
			};

			beforeEach(async () => {
				validatorService.parseOpenSpecChange.mockReturnValue({ change, ok: true as const });
				promptService.buildDelegationPrompt.mockReturnValue('delegation prompt');
			});

			it('should emit agent activity for building prompt', async () => {
				await processor.handleCreated(event);

				expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
					client,
					'session-1',
					expect.objectContaining({
						body: 'Built the prompt. Starting implementation...',
						type: AgentActivityType.Thought,
					})
				);
			});

			it('should build delegation prompt with parsed change', async () => {
				await processor.handleCreated(event);

				expect(promptService.buildDelegationPrompt).toHaveBeenCalledWith(payload, change);
			});

			it('should prompt opencode asynchronously', async () => {
				await processor.handleCreated(event);

				expect(opencodeService.promptAsync).toHaveBeenCalledWith(
					'repo',
					'oc-session-1',
					'delegation prompt'
				);
			});

			it('should emit completion activity and ensure event stream', async () => {
				await processor.handleCreated(event);

				expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
					client,
					'session-1',
					expect.objectContaining({
						body: 'Prompted the model asynchronously',
						type: AgentActivityType.Thought,
					})
				);
				expect(opencodeEventStreamService.ensureStream).toHaveBeenCalledWith('repo');
			});
		});

		it('should handle issue description being undefined', async () => {
			const eventWithoutDesc = {
				...event,
				issue: { description: undefined } as Issue,
			} as AgentSessionCreatedEvent;
			validatorService.parseOpenSpecChange.mockReturnValue({
				message: 'No marker found',
				ok: false as const,
				reason: 'missing-marker',
			});
			await linearService.abortDelegation.mockResolvedValue();
			await repository.updateStatus.mockResolvedValue();

			await processor.handleCreated(eventWithoutDesc);

			expect(validatorService.parseOpenSpecChange).toHaveBeenCalledWith('');
		});

		it('should handle issue description being null', async () => {
			const eventWithNullDesc = {
				...event,
				issue: { description: null } as Issue,
			} as AgentSessionCreatedEvent;
			validatorService.parseOpenSpecChange.mockReturnValue({
				message: 'No marker found',
				ok: false as const,
				reason: 'missing-marker',
			});
			await linearService.abortDelegation.mockResolvedValue();
			await repository.updateStatus.mockResolvedValue();

			await processor.handleCreated(eventWithNullDesc);

			expect(validatorService.parseOpenSpecChange).toHaveBeenCalledWith('');
		});
	});

	describe('handlePrompted', () => {
		const client = {} as LinearClient;
		const payload = {} as AgentSessionEventWebhookPayload;
		const event = {
			agentSessionId: 'session-1',
			client,
			issueId: 'issue-1',
			issueTitle: 'title',
			mode: 'mention' as const,
			openCodeSessionId: 'oc-session-1',
			payload,
			repositoryName: 'repo',
		} as AgentSessionPromptedEvent;

		beforeEach(async () => {
			await linearService.emitAgentActivity.mockResolvedValue();
			promptService.buildMentionPrompt.mockReturnValue('mention prompt');
			await opencodeService.promptAsync.mockResolvedValue();
			opencodeEventStreamService.ensureStream.mockReturnValue();
		});

		it('should emit agent activity for starting processing', async () => {
			await processor.handlePrompted(event);

			expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
				client,
				'session-1',
				expect.objectContaining({
					body: 'Starting to process the question',
					type: AgentActivityType.Thought,
				})
			);
		});

		it('should build mention prompt', async () => {
			await processor.handlePrompted(event);

			expect(promptService.buildMentionPrompt).toHaveBeenCalledWith(payload);
		});

		it('should prompt opencode with read-only tools', async () => {
			await processor.handlePrompted(event);

			expect(opencodeService.promptAsync).toHaveBeenCalledWith(
				'repo',
				'oc-session-1',
				'mention prompt',
				MENTION_READ_ONLY_TOOLS
			);
		});

		it('should ensure event stream', async () => {
			await processor.handlePrompted(event);

			expect(opencodeEventStreamService.ensureStream).toHaveBeenCalledWith('repo');
		});
	});
});
