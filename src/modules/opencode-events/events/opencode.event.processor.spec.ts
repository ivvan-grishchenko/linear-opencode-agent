import type { LinearClient } from '@linear/sdk';
import type { ActivityContent, ILinearService } from '@modules/linear';
import type { IOpencodeService } from '@modules/opencode';
import type { EventMessagePartUpdated, Part } from '@opencode-ai/sdk';
import type { Mocked } from '@suites/unit';

import { AgentActivityType } from '@linear/sdk';
import { LinearInject } from '@modules/linear';
import { OpencodeInject } from '@modules/opencode';
import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
	IOpencodeEventMapperService,
	IOpencodeEventRepository,
	IOpencodeEventStreamService,
} from '../interface';
import type { OpencodeEventReceived, ResolvedSession } from '../opencode-events.type';

import { OpencodeEventsInject } from '../opencode-events.enum';
import { OpencodeEventProcessor } from './opencode.event.processor';

describe('opencodeEventProcessor', () => {
	let processor: OpencodeEventProcessor;
	let streamService: Mocked<IOpencodeEventStreamService>;
	let mapperService: Mocked<IOpencodeEventMapperService>;
	let repository: Mocked<IOpencodeEventRepository>;
	let linearService: Mocked<ILinearService>;
	let opencodeService: Mocked<IOpencodeService>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(OpencodeEventProcessor).compile();

		processor = unit;
		streamService = unitRef.get(OpencodeEventsInject.STREAM_SERVICE);
		mapperService = unitRef.get(OpencodeEventsInject.MAPPER_SERVICE);
		repository = unitRef.get(OpencodeEventsInject.REPOSITORY);
		linearService = unitRef.get(LinearInject.SERVICE);
		opencodeService = unitRef.get(OpencodeInject.SERVICE);
	});

	afterEach(() => vi.resetAllMocks());

	describe('processEvent', () => {
		it('should exit early if cannot resolve session', async () => {
			const processorEvent = {
				event: { type: 'message.part.updated' },
				openCodeSessionId: 'session-1',
			} as OpencodeEventReceived;
			await repository.findSession.mockResolvedValue(null);

			await processor.processEvent(processorEvent);

			expect(linearService.emitAgentActivity).not.toHaveBeenCalled();
			expect(mapperService.translatePart).not.toHaveBeenCalled();
		});

		describe('should handle the message.part.updated', () => {
			const resolvedSession = {
				agentSessionId: 'agent-session-1',
				client: {} as LinearClient,
			} as ResolvedSession;

			beforeEach(async () => {
				await repository.findSession.mockResolvedValue(resolvedSession);
			});

			it('should return early if type is text', async () => {
				const processorEvent = {
					event: {
						properties: { part: { type: 'text' } },
						type: 'message.part.updated',
					} as EventMessagePartUpdated,
					openCodeSessionId: 'session-1',
				} as OpencodeEventReceived;

				await processor.processEvent(processorEvent);

				expect(mapperService.translatePart).not.toHaveBeenCalled();
				expect(linearService.emitAgentActivity).not.toHaveBeenCalled();
			});

			it('should return if type tool and status running', async () => {
				const processorEvent = {
					event: {
						properties: { part: { state: { status: 'running' }, type: 'tool' } },
						type: 'message.part.updated',
					} as EventMessagePartUpdated,
					openCodeSessionId: 'session-1',
				} as OpencodeEventReceived;

				await processor.processEvent(processorEvent);

				expect(mapperService.translatePart).not.toHaveBeenCalled();
				expect(linearService.emitAgentActivity).not.toHaveBeenCalled();
			});

			describe('type tool and status completed', () => {
				let processorEvent: OpencodeEventReceived;
				let part: Part;

				beforeEach(() => {
					part = { state: { status: 'completed' }, type: 'tool' } as Part;
					processorEvent = {
						event: {
							properties: { part },
							type: 'message.part.updated',
						} as EventMessagePartUpdated,
						openCodeSessionId: 'session-1',
					} as OpencodeEventReceived;
				});

				it('should not emit agent activity if translating fails', async () => {
					mapperService.translatePart.mockReturnValue(null);

					await processor.processEvent(processorEvent);

					expect(mapperService.translatePart).toHaveBeenCalledWith(part, { isFinal: false });
					expect(linearService.emitAgentActivity).not.toHaveBeenCalled();
				});

				it('should emit agent activity if translating succeeds', async () => {
					const content = {} as ActivityContent;
					mapperService.translatePart.mockReturnValue(content);

					await processor.processEvent(processorEvent);

					expect(mapperService.translatePart).toHaveBeenCalledWith(part, { isFinal: false });
					expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
						resolvedSession.client,
						resolvedSession.agentSessionId,
						content
					);
				});
			});

			it('should handle non-text, non-tool parts and deduplicate', async () => {
				const content = { body: 'reasoning' } as ActivityContent;
				mapperService.translatePart.mockReturnValue(content);

				const part1 = { id: 'reason-1', type: 'reasoning' } as Part;
				const event1 = {
					event: {
						properties: { part: part1 },
						type: 'message.part.updated',
					} as EventMessagePartUpdated,
					openCodeSessionId: 'session-1',
				} as OpencodeEventReceived;

				const part2 = { id: 'reason-2', type: 'reasoning' } as Part;
				const event2 = {
					event: {
						properties: { part: part2 },
						type: 'message.part.updated',
					} as EventMessagePartUpdated,
					openCodeSessionId: 'session-1',
				} as OpencodeEventReceived;

				await processor.processEvent(event1);
				await processor.processEvent(event2);
				await processor.processEvent(event1);

				expect(mapperService.translatePart).toHaveBeenCalledTimes(2);
				expect(linearService.emitAgentActivity).toHaveBeenCalledTimes(2);
			});
		});

		describe('should handle the session.idle', () => {
			const processorEvent = {
				event: { type: 'session.idle' },
			} as OpencodeEventReceived;
			const resolvedSession: ResolvedSession = {
				agentSessionId: 'agent-session-1',
				openCodeSessionId: 'session-1',
				repositoryName: 'repository',
			} as ResolvedSession;

			beforeEach(async () => {
				await repository.findSession.mockResolvedValue(resolvedSession);
			});

			it('should not emit any events when session is not finished', async () => {
				await opencodeService.isSessionFinished.mockResolvedValue(false);

				await processor.processEvent(processorEvent);

				expect(opencodeService.isSessionFinished).toHaveBeenCalledWith(
					resolvedSession.repositoryName,
					resolvedSession.openCodeSessionId
				);
				expect(repository.updateStatus).not.toHaveBeenCalled();
				expect(streamService.releaseStream).not.toHaveBeenCalled();
			});

			it('should emit events when session is finished', async () => {
				await opencodeService.isSessionFinished.mockResolvedValue(true);
				await opencodeService.getMessages.mockResolvedValue([]);

				await processor.processEvent(processorEvent);

				expect(opencodeService.isSessionFinished).toHaveBeenCalledWith(
					resolvedSession.repositoryName,
					resolvedSession.openCodeSessionId
				);
				expect(repository.updateStatus).toHaveBeenCalledWith(
					resolvedSession.agentSessionId,
					'completed'
				);
				expect(streamService.releaseStream).toHaveBeenCalledWith(resolvedSession.repositoryName);
			});

			it('should emit final text parts when session finishes with messages', async () => {
				const textPart1 = { text: 'Step 1', type: 'text' } as Part;
				const textPart2 = { text: 'Step 2', type: 'text' } as Part;
				const messages = [
					{ info: { role: 'assistant' }, parts: [textPart1] },
					{ info: { role: 'user' }, parts: [] },
					{ info: { role: 'assistant' }, parts: [textPart2] },
				] as any;

				await opencodeService.isSessionFinished.mockResolvedValue(true);
				await opencodeService.getMessages.mockResolvedValue(messages);

				const content1 = { body: 'Step 1' } as ActivityContent;
				const content2 = { body: 'Step 2' } as ActivityContent;
				mapperService.translatePart.mockReturnValueOnce(content1).mockReturnValueOnce(content2);

				await processor.processEvent(processorEvent);

				expect(mapperService.translatePart).toHaveBeenNthCalledWith(1, textPart1, {
					isFinal: false,
				});
				expect(mapperService.translatePart).toHaveBeenNthCalledWith(2, textPart2, {
					isFinal: true,
				});
				expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
					resolvedSession.client,
					resolvedSession.agentSessionId,
					content1
				);
				expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
					resolvedSession.client,
					resolvedSession.agentSessionId,
					content2
				);
			});

			it('should skip null translatePart results when emitting final text', async () => {
				const textPart = { text: 'Hello', type: 'text' } as Part;
				const messages = [{ info: { role: 'assistant' }, parts: [textPart, textPart] }] as any;

				await opencodeService.isSessionFinished.mockResolvedValue(true);
				await opencodeService.getMessages.mockResolvedValue(messages);

				const content = { body: 'World' } as ActivityContent;
				mapperService.translatePart.mockReturnValueOnce(null).mockReturnValueOnce(content);

				await processor.processEvent(processorEvent);

				expect(linearService.emitAgentActivity).toHaveBeenCalledTimes(1);
				expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
					resolvedSession.client,
					resolvedSession.agentSessionId,
					content
				);
			});

			describe('delegation mode with PR URL extraction', () => {
				beforeEach(async () => {
					resolvedSession.mode = 'delegation';
					await repository.findSession.mockResolvedValue(resolvedSession);
				});

				it('should update external URL when PR URL is found in final text', async () => {
					const textPart = {
						text: 'Check the PR: https://github.com/owner/repo/pull/42',
						type: 'text',
					} as Part;
					const messages = [{ info: { role: 'assistant' }, parts: [textPart] }] as any;

					await opencodeService.isSessionFinished.mockResolvedValue(true);
					await opencodeService.getMessages.mockResolvedValue(messages);
					mapperService.translatePart.mockReturnValue({ body: 'done' } as ActivityContent);

					await processor.processEvent(processorEvent);

					expect(linearService.updateSessionExternalUrl).toHaveBeenCalledWith(
						resolvedSession.client,
						resolvedSession.agentSessionId,
						'https://github.com/owner/repo/pull/42'
					);
				});

				it('should not update external URL when no PR URL is found', async () => {
					const textPart = { text: 'Done with the work', type: 'text' } as Part;
					const messages = [{ info: { role: 'assistant' }, parts: [textPart] }] as any;

					await opencodeService.isSessionFinished.mockResolvedValue(true);
					await opencodeService.getMessages.mockResolvedValue(messages);
					mapperService.translatePart.mockReturnValue({ body: 'done' } as ActivityContent);

					await processor.processEvent(processorEvent);

					expect(linearService.updateSessionExternalUrl).not.toHaveBeenCalled();
				});

				it('should handle delegation with no text parts in messages', async () => {
					await opencodeService.isSessionFinished.mockResolvedValue(true);
					await opencodeService.getMessages.mockResolvedValue([]);

					await processor.processEvent(processorEvent);

					expect(linearService.updateSessionExternalUrl).not.toHaveBeenCalled();
					expect(repository.updateStatus).toHaveBeenCalledWith(
						resolvedSession.agentSessionId,
						'completed'
					);
					expect(streamService.releaseStream).toHaveBeenCalledWith(resolvedSession.repositoryName);
				});
			});
		});

		describe('should handle session.error', () => {
			const processorEvent = {
				event: {
					properties: { error: { data: { message: 'Session encountered an unknown error' } } },
					type: 'session.error',
				},
			} as OpencodeEventReceived;
			const resolvedSession: ResolvedSession = {
				agentSessionId: 'agent-session-1',
				client: {} as LinearClient,
				openCodeSessionId: 'session-1',
				repositoryName: 'repository',
			} as ResolvedSession;

			beforeEach(async () => {
				await repository.findSession.mockResolvedValue(resolvedSession);
			});

			it('should emit all necessary events', async () => {
				await processor.processEvent(processorEvent);

				expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
					resolvedSession.client,
					resolvedSession.agentSessionId,
					{
						body: 'Session error: Session encountered an unknown error',
						type: AgentActivityType.Error,
					}
				);
				expect(repository.updateStatus).toHaveBeenCalledWith(
					resolvedSession.agentSessionId,
					'failed',
					'Session error: Session encountered an unknown error'
				);
				expect(streamService.releaseStream).toHaveBeenCalledWith(resolvedSession.repositoryName);
			});

			it('should handle error with undefined error property', async () => {
				const eventNoError = {
					event: {
						properties: {},
						type: 'session.error',
					},
				} as OpencodeEventReceived;

				await processor.processEvent(eventNoError);

				expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
					resolvedSession.client,
					resolvedSession.agentSessionId,
					{ body: 'Session encountered an unknown error', type: AgentActivityType.Error }
				);
				expect(repository.updateStatus).toHaveBeenCalledWith(
					resolvedSession.agentSessionId,
					'failed',
					'Session encountered an unknown error'
				);
			});

			it('should handle error with non-string data message', async () => {
				const eventNoMessage = {
					event: {
						properties: { error: { data: {} as any, name: 'CustomError' } },
						type: 'session.error',
					} as any,
					openCodeSessionId: 'session-1',
					repositoryName: 'repository',
				} as OpencodeEventReceived;

				await processor.processEvent(eventNoMessage);

				expect(linearService.emitAgentActivity).toHaveBeenCalledWith(
					resolvedSession.client,
					resolvedSession.agentSessionId,
					{ body: 'Session error: CustomError', type: AgentActivityType.Error }
				);
				expect(repository.updateStatus).toHaveBeenCalledWith(
					resolvedSession.agentSessionId,
					'failed',
					'Session error: CustomError'
				);
			});
		});

		it('should do nothing for unrecognized event types', async () => {
			const resolvedSession = {
				agentSessionId: 'agent-session-1',
				client: {} as LinearClient,
			} as ResolvedSession;
			await repository.findSession.mockResolvedValue(resolvedSession);

			const processorEvent = {
				event: { type: 'some.unknown.event' } as any,
				openCodeSessionId: 'session-1',
				repositoryName: 'repository',
			} as OpencodeEventReceived;

			await processor.processEvent(processorEvent);

			expect(linearService.emitAgentActivity).not.toHaveBeenCalled();
			expect(repository.updateStatus).not.toHaveBeenCalled();
			expect(streamService.releaseStream).not.toHaveBeenCalled();
		});
	});
});
