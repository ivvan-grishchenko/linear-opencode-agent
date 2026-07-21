import type { DatabaseClient } from '@modules/database';
import type { IOpencodeService } from '@modules/opencode';
import type { Event } from '@opencode-ai/sdk';
import type { Mocked } from '@suites/unit';
import type { ChainMock } from 'chain-mock';

import { agentSessions } from '@db/schema';
import { DatabaseInject } from '@modules/database';
import { OpencodeInject } from '@modules/opencode';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TestBed } from '@suites/unit';
import { chainMock } from 'chain-mock';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IOpencodeEventMapperService, IOpencodeEventRepository } from '../interface';

import { OpencodeEventsInject } from '../opencode-events.enum';
import { OpencodeEventStreamService } from './opencode-event-stream.service';

function createEventGenerator(events: Event[]): AsyncGenerator<Event> {
	async function* gen(): AsyncGenerator<Event> {
		for (const event of events) yield event;
	}

	return gen();
}

describe('opencodeEventStreamService', () => {
	let streamService: OpencodeEventStreamService;
	let repository: Mocked<IOpencodeEventRepository>;
	let mapperService: Mocked<IOpencodeEventMapperService>;
	let db: ChainMock<DatabaseClient>;
	let opencodeService: Mocked<IOpencodeService>;
	let eventEmitter: Mocked<EventEmitter2>;

	beforeEach(async () => {
		vi.clearAllMocks();
		db = chainMock<DatabaseClient>();

		const { unit, unitRef } = await TestBed.solitary(OpencodeEventStreamService)
			.mock(DatabaseInject.CLIENT)
			.impl(() => db)
			.compile();

		streamService = unit;
		repository = unitRef.get(OpencodeEventsInject.REPOSITORY);
		mapperService = unitRef.get(OpencodeEventsInject.MAPPER_SERVICE);
		opencodeService = unitRef.get(OpencodeInject.SERVICE);
		eventEmitter = unitRef.get(EventEmitter2);
	});

	afterEach(() => vi.resetAllMocks());

	describe('ensureStream', () => {
		it('should create a new stream and start consuming events', async () => {
			const event = { properties: { sessionID: 'ses-1' }, type: 'session.idle' } as Event;
			vi.mocked(opencodeService.getEventsStream).mockResolvedValue(createEventGenerator([event]));
			mapperService.extractSessionId.mockReturnValue('ses-1');

			streamService.ensureStream('test-repo');
			await vi.waitFor(() => {
				expect(eventEmitter.emit).toHaveBeenCalledWith('opencode.event.received', {
					event,
					openCodeSessionId: 'ses-1',
					repositoryName: 'test-repo',
				});
			});
		});

		it('should pass the AbortSignal to getEventsStream', async () => {
			let capturedSignal: AbortSignal | undefined;
			vi.mocked(opencodeService.getEventsStream).mockImplementation(
				async (_repo: string, options?: { signal?: AbortSignal }) => {
					capturedSignal = options?.signal;
					return createEventGenerator([]);
				}
			);

			streamService.ensureStream('test-repo');
			await vi.waitFor(() => {
				expect(capturedSignal).toBeDefined();
				expect(capturedSignal?.aborted).toBeFalsy();
			});
		});

		it('should increment activeCount when repository is already tracked', async () => {
			vi.mocked(opencodeService.getEventsStream).mockResolvedValue(createEventGenerator([]));

			streamService.ensureStream('test-repo');
			await vi.waitFor(() => {
				expect(opencodeService.getEventsStream).toHaveBeenCalledTimes(1);
			});

			streamService.ensureStream('test-repo');

			expect(opencodeService.getEventsStream).toHaveBeenCalledTimes(1);
		});
	});

	describe('releaseStream', () => {
		it('should decrement activeCount and stop the stream when it reaches zero', async () => {
			let capturedSignal: AbortSignal | undefined;
			vi.mocked(opencodeService.getEventsStream).mockImplementation(
				async (_repo: string, options?: { signal?: AbortSignal }) => {
					capturedSignal = options?.signal;
					return createEventGenerator([]);
				}
			);

			streamService.ensureStream('test-repo');
			await vi.waitFor(() => {
				expect(capturedSignal).toBeDefined();
			});

			streamService.releaseStream('test-repo');

			expect(capturedSignal!.aborted).toBeTruthy();
		});

		it('should not stop the stream if activeCount is still positive', async () => {
			let capturedSignal: AbortSignal | undefined;
			vi.mocked(opencodeService.getEventsStream).mockImplementation(
				async (_repo: string, options?: { signal?: AbortSignal }) => {
					capturedSignal = options?.signal;
					return createEventGenerator([]);
				}
			);

			streamService.ensureStream('test-repo');
			await vi.waitFor(() => {
				expect(capturedSignal).toBeDefined();
			});

			streamService.ensureStream('test-repo');
			streamService.releaseStream('test-repo');

			expect(capturedSignal!.aborted).toBeFalsy();
		});

		it('should do nothing when repository is not tracked', () => {
			expect(() => streamService.releaseStream('unknown-repo')).not.toThrow();
		});
	});

	describe('event processing', () => {
		it('should skip events where extractSessionId returns undefined', async () => {
			const event = { type: 'server.connected' } as Event;
			vi.mocked(opencodeService.getEventsStream).mockResolvedValue(createEventGenerator([event]));
			mapperService.extractSessionId.mockReturnValue(undefined);

			streamService.ensureStream('test-repo');
			await vi.waitFor(() => {
				// oxlint-disable-next-line vitest/prefer-called-with
				expect(opencodeService.getEventsStream).toHaveBeenCalled();
			});
			// oxlint-disable-next-line promise/avoid-new
			await new Promise<void>((resolve) => resolve());

			expect(eventEmitter.emit).not.toHaveBeenCalled();
		});

		it('should reset the stall timer on each received event', async () => {
			vi.useFakeTimers();

			const event = { properties: { sessionID: 'ses-1' }, type: 'session.idle' } as Event;

			async function* gen(): AsyncGenerator<Event> {
				yield event;
				// oxlint-disable-next-line promise/avoid-new
				await new Promise(() => {});
			}
			vi.mocked(opencodeService.getEventsStream).mockResolvedValue(gen());
			mapperService.extractSessionId.mockReturnValue('ses-1');

			streamService.ensureStream('test-repo');

			await vi.advanceTimersByTimeAsync(1);
			expect(eventEmitter.emit).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(4 * 60 * 1_000);
			expect(repository.markSessionsFailed).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(2 * 60 * 1_000);
			expect(repository.markSessionsFailed).toHaveBeenCalledWith(
				'test-repo',
				expect.stringContaining('stalled')
			);

			vi.useRealTimers();
		});
	});

	describe('error handling', () => {
		it('should call markSessionsFailed on non-abort errors', async () => {
			vi.mocked(opencodeService.getEventsStream).mockRejectedValue(new Error('Connection lost'));

			streamService.ensureStream('test-repo');
			await vi.waitFor(() => {
				expect(repository.markSessionsFailed).toHaveBeenCalledWith(
					'test-repo',
					expect.stringContaining('Connection lost')
				);
			});
		});

		it('should log and return on AbortError without marking sessions failed', async () => {
			vi.mocked(opencodeService.getEventsStream).mockRejectedValue(
				Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
			);

			streamService.ensureStream('test-repo');
			await vi.waitFor(() => {
				expect(repository.markSessionsFailed).not.toHaveBeenCalled();
			});
		});
	});

	describe('onModuleInit', () => {
		it('should ensure streams for unique repository names from processing sessions', async () => {
			const ensureStreamSpy = vi.spyOn(streamService, 'ensureStream');
			vi.mocked(opencodeService.getEventsStream).mockResolvedValue(createEventGenerator([]));

			db.select.from.where.mockResolvedValueOnce([
				{ repositoryName: 'repo-a' },
				{ repositoryName: 'repo-b' },
				{ repositoryName: 'repo-a' },
			]);

			await streamService.onModuleInit();

			expect(ensureStreamSpy).toHaveBeenCalledTimes(2);
			expect(ensureStreamSpy).toHaveBeenCalledWith('repo-a');
			expect(ensureStreamSpy).toHaveBeenCalledWith('repo-b');
		});

		it('should filter out null repository names', async () => {
			const ensureStreamSpy = vi.spyOn(streamService, 'ensureStream');
			vi.mocked(opencodeService.getEventsStream).mockResolvedValue(createEventGenerator([]));

			db.select.from.where.mockResolvedValueOnce([
				{ repositoryName: null },
				{ repositoryName: 'repo-a' },
			]);

			await streamService.onModuleInit();

			expect(ensureStreamSpy).toHaveBeenCalledTimes(1);
			expect(ensureStreamSpy).toHaveBeenCalledWith('repo-a');
		});

		it('should query processing sessions from the DB', async () => {
			vi.mocked(opencodeService.getEventsStream).mockResolvedValue(createEventGenerator([]));
			db.select.from.where.mockResolvedValueOnce([]);

			await streamService.onModuleInit();

			expect(db.select.from.where).toHaveBeenChainCalledWith(
				[{ repositoryName: agentSessions.repositoryName }],
				[agentSessions],
				[eq(agentSessions.status, 'processing')]
			);
		});

		it('should do nothing when no processing sessions exist', async () => {
			const ensureStreamSpy = vi.spyOn(streamService, 'ensureStream');
			vi.mocked(opencodeService.getEventsStream).mockResolvedValue(createEventGenerator([]));
			db.select.from.where.mockResolvedValueOnce([]);

			await streamService.onModuleInit();

			expect(ensureStreamSpy).not.toHaveBeenCalled();
		});
	});
});
