import type { Event } from '@opencode-ai/sdk';

import { AgentActivityType } from '@linear/sdk';
import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpencodeEventMapperService } from './opencode-event.mapper.service';

const directPropertiesTypes = [
	'session.idle',
	'session.status',
	'session.compacted',
	'session.diff',
	'session.error',
	'message.removed',
	'message.part.removed',
	'permission.updated',
	'permission.replied',
	'todo.updated',
	'command.executed',
];
const propertyInfoTypes = ['session.created', 'session.updated', 'session.deleted'];
const globalEvents = [
	'server.instance.disposed',
	'server.connected',
	'installation.updated',
	'installation.update-available',
	'lsp.client.diagnostics',
	'lsp.updated',
	'file.edited',
	'file.watcher.updated',
	'vcs.branch.updated',
	'tui.prompt.append',
	'tui.command.execute',
	'tui.toast.show',
	'pty.created',
	'pty.updated',
	'pty.exited',
	'pty.deleted',
];

describe('opencodeEventMapperService', () => {
	let mapperService: OpencodeEventMapperService;

	beforeEach(async () => {
		const { unit } = await TestBed.solitary(OpencodeEventMapperService).compile();

		mapperService = unit;
	});

	afterEach(() => vi.resetAllMocks());

	describe('extractSessionId', () => {
		it.for(directPropertiesTypes)(
			'should return session from sessionId for event type %s',
			(type) => {
				const sessionID = 'sessionId';
				const event: Event = { properties: { sessionID }, type } as Event;

				const result = mapperService.extractSessionId(event);

				expect(result).toBe(sessionID);
			}
		);

		it.for(propertyInfoTypes)(
			'should return session from property info id for event type %s',
			(type) => {
				const sessionID = 'sessionId';
				const event: Event = { properties: { info: { id: sessionID } }, type } as Event;

				const result = mapperService.extractSessionId(event);

				expect(result).toBe(sessionID);
			}
		);

		it('should return from property info sessionID for event type message.updated', () => {
			const sessionID = 'sessionId';
			const event: Event = {
				properties: { info: { sessionID } },
				type: 'message.updated',
			} as Event;

			const result = mapperService.extractSessionId(event);

			expect(result).toBe(sessionID);
		});

		it('should return from property part sessionID for event type message.part.updated', () => {
			const sessionID = 'sessionId';
			const event: Event = {
				properties: { part: { sessionID } },
				type: 'message.part.updated',
			} as Event;

			const result = mapperService.extractSessionId(event);

			expect(result).toBe(sessionID);
		});

		it.for(globalEvents)('should return undefined for event type %s', (type) => {
			const event: Event = { type } as Event;

			const result = mapperService.extractSessionId(event);

			expect(result).toBeUndefined();
		});

		it('should return undefined for unknown event type', () => {
			const event: Event = { type: 'unknown' } as unknown as Event;

			const result = mapperService.extractSessionId(event);

			expect(result).toBeUndefined();
		});
	});

	describe('translatePart', () => {
		describe('text part', () => {
			it('should return Response when isFinal is true', () => {
				const result = mapperService.translatePart({ text: 'Hello', type: 'text' } as never, {
					isFinal: true,
				});

				expect(result).toStrictEqual({ body: 'Hello', type: AgentActivityType.Response });
			});

			it('should return Thought when isFinal is false', () => {
				const result = mapperService.translatePart({ text: 'Thinking...', type: 'text' } as never, {
					isFinal: false,
				});

				expect(result).toStrictEqual({ body: 'Thinking...', type: AgentActivityType.Thought });
			});
		});

		describe('reasoning part', () => {
			it('should return Thought with reasoning text', () => {
				const result = mapperService.translatePart(
					{ text: 'Let me think...', type: 'reasoning' } as never,
					{ isFinal: false }
				);

				expect(result).toStrictEqual({ body: 'Let me think...', type: AgentActivityType.Thought });
			});
		});

		describe('tool part', () => {
			it('should return Action with formatted parameter when state is pending', () => {
				const result = mapperService.translatePart(
					{
						state: { input: { path: '/test' }, status: 'pending' },
						tool: 'read_file',
						type: 'tool',
					} as never,
					{ isFinal: false }
				);

				expect(result).toStrictEqual({
					action: 'read_file',
					parameter: JSON.stringify({ path: '/test' }),
					type: AgentActivityType.Action,
				});
			});

			it('should return Action with formatted parameter when state is running', () => {
				const result = mapperService.translatePart(
					{
						state: { input: { path: '/test' }, status: 'running' },
						tool: 'read_file',
						type: 'tool',
					} as never,
					{ isFinal: false }
				);

				expect(result).toStrictEqual({
					action: 'read_file',
					parameter: JSON.stringify({ path: '/test' }),
					type: AgentActivityType.Action,
				});
			});

			it('should return Action with result when state is completed', () => {
				const result = mapperService.translatePart(
					{
						state: { input: { path: '/test' }, output: 'file content', status: 'completed' },
						tool: 'read_file',
						type: 'tool',
					} as never,
					{ isFinal: false }
				);

				expect(result).toStrictEqual({
					action: 'read_file',
					parameter: JSON.stringify({ path: '/test' }),
					result: 'file content',
					type: AgentActivityType.Action,
				});
			});

			it('should return Error when state is error', () => {
				const result = mapperService.translatePart(
					{
						state: { error: 'Command not found', input: {}, status: 'error' },
						tool: 'execute_command',
						type: 'tool',
					} as never,
					{ isFinal: false }
				);

				expect(result).toStrictEqual({
					body: 'Tool execute_command failed: Command not found',
					type: AgentActivityType.Error,
				});
			});

			it('should return null for unknown state status', () => {
				const result = mapperService.translatePart(
					{ state: { input: {}, status: 'unknown' }, tool: 'test', type: 'tool' } as never,
					{ isFinal: false }
				);

				expect(result).toBeNull();
			});

			describe('formatParameter edge cases', () => {
				it('should return empty string when tool input is undefined', () => {
					const result = mapperService.translatePart(
						{ state: { input: undefined, status: 'running' }, tool: 'test', type: 'tool' } as never,
						{ isFinal: false }
					);

					expect(result).toStrictEqual({
						action: 'test',
						parameter: '',
						type: AgentActivityType.Action,
					});
				});

				it('should return empty string when tool input is an empty object', () => {
					const result = mapperService.translatePart(
						{ state: { input: {}, status: 'running' }, tool: 'test', type: 'tool' } as never,
						{ isFinal: false }
					);

					expect(result).toStrictEqual({
						action: 'test',
						parameter: '',
						type: AgentActivityType.Action,
					});
				});

				it('should truncate parameter that exceeds MAX_PARAM_LENGTH', () => {
					const largeInput = { data: 'x'.repeat(600) };
					const result = mapperService.translatePart(
						{
							state: { input: largeInput, status: 'pending' },
							tool: 'test',
							type: 'tool',
						} as never,
						{ isFinal: false }
					);

					expect(result).toStrictEqual({
						action: 'test',
						parameter: `${JSON.stringify(largeInput).slice(0, 500)}...`,
						type: AgentActivityType.Action,
					});
				});
			});
		});

		describe('patch part', () => {
			it('should return Action with files joined', () => {
				const result = mapperService.translatePart(
					{ files: ['src/a.ts', 'src/b.ts'], type: 'patch' } as never,
					{ isFinal: false }
				);

				expect(result).toStrictEqual({
					action: 'Edited files',
					parameter: 'src/a.ts, src/b.ts',
					type: AgentActivityType.Action,
				});
			});
		});

		describe('retry part', () => {
			it('should return Thought with retry message', () => {
				const result = mapperService.translatePart(
					{ attempt: 2, error: { data: { message: 'Timeout' } }, type: 'retry' } as never,
					{ isFinal: false }
				);

				expect(result).toStrictEqual({
					body: 'Retrying after error (attempt 2): Timeout',
					type: AgentActivityType.Thought,
				});
			});
		});

		describe('step-start part', () => {
			it('should return Thought with starting next step message', () => {
				const result = mapperService.translatePart({ type: 'step-start' } as never, {
					isFinal: false,
				});

				expect(result).toStrictEqual({
					body: 'Starting next step...',
					type: AgentActivityType.Thought,
				});
			});
		});

		describe('step-finish part', () => {
			it('should return Thought with total token count', () => {
				const tokens = { cache: { read: 10, write: 5 }, input: 100, output: 50, reasoning: 20 };
				const total = 100 + 50 + 20 + 10 + 5;

				const result = mapperService.translatePart({ tokens, type: 'step-finish' } as never, {
					isFinal: false,
				});

				expect(result).toStrictEqual({
					body: `Step finished. Tokens used: ${total}`,
					type: AgentActivityType.Thought,
				});
			});
		});

		describe('parts that return null', () => {
			it.for(['file', 'subtask', 'agent', 'snapshot', 'compaction'] as const)(
				'should return null for %s part type',
				(type) => {
					const result = mapperService.translatePart({ type } as never, { isFinal: false });

					expect(result).toBeNull();
				}
			);
		});

		it('should return null for unknown part type', () => {
			const result = mapperService.translatePart({ type: 'unknown' } as never, { isFinal: false });

			expect(result).toBeNull();
		});
	});
});
