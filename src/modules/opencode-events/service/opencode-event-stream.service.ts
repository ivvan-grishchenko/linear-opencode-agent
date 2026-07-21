import type { DatabaseClient } from '@modules/database';
import type { IOpencodeService } from '@modules/opencode';

import { agentSessions } from '@db/schema';
import { DatabaseInject } from '@modules/database';
import { OpencodeInject } from '@modules/opencode';
import { OpencodeEventsInject } from '@modules/opencode-events';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
// oxlint-disable-next-line typescript/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';

import type {
	IOpencodeEventMapperService,
	IOpencodeEventRepository,
	IOpencodeEventStreamService,
} from '../interface';

const EVENT_STREAM_STALL_TIMEOUT_MINUTES = 5;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1_000;
const EVENT_STREAM_STALL_TIMEOUT_MS =
	EVENT_STREAM_STALL_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

interface StreamState {
	activeCount: number;
	controller: AbortController;
	repositoryName: string;
}

@Injectable()
export class OpencodeEventStreamService implements IOpencodeEventStreamService, OnModuleInit {
	private readonly logger = new Logger(OpencodeEventStreamService.name);
	private readonly stallTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly streams = new Map<string, StreamState>();

	constructor(
		@Inject(OpencodeEventsInject.REPOSITORY)
		private readonly repository: IOpencodeEventRepository,
		@Inject(OpencodeEventsInject.MAPPER_SERVICE)
		private readonly mapperService: IOpencodeEventMapperService,

		@Inject(DatabaseInject.CLIENT)
		private readonly db: DatabaseClient,
		@Inject(OpencodeInject.SERVICE)
		private readonly opencodeService: IOpencodeService,

		private readonly eventEmitter: EventEmitter2
	) {}

	async onModuleInit(): Promise<void> {
		const rows = await this.db
			.select({ repositoryName: agentSessions.repositoryName })
			.from(agentSessions)
			.where(eq(agentSessions.status, 'processing'));

		const repositoryNames = [
			...new Set(
				rows
					.map((row: { repositoryName: string | null }) => row.repositoryName)
					.filter((name): name is string => Boolean(name))
			),
		];

		for (const repositoryName of repositoryNames) this.ensureStream(repositoryName);
	}

	ensureStream(repositoryName: string): void {
		const state = this.streams.get(repositoryName);

		if (state) {
			state.activeCount++;

			return;
		}

		const controller = new AbortController();
		const newState: StreamState = {
			activeCount: 1,
			controller,
			repositoryName,
		};

		this.streams.set(repositoryName, newState);
		this.resetStallTimer(repositoryName, newState);

		// oxlint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then
		this.runStream(repositoryName, newState).catch((error) => {
			this.logger.error(`Opencode event stream crashed for ${repositoryName}`, error);
			this.stopStream(repositoryName);
		});
	}

	releaseStream(repositoryName: string): void {
		const state = this.streams.get(repositoryName);

		if (!state) return;

		state.activeCount--;

		if (state.activeCount <= 0) this.stopStream(repositoryName);
	}

	private async runStream(repositoryName: string, state: StreamState): Promise<void> {
		try {
			const events = await this.opencodeService.getEventsStream(repositoryName, {
				signal: state.controller.signal,
			});

			for await (const event of events) {
				this.resetStallTimer(repositoryName, state);

				const openCodeSessionId = this.mapperService.extractSessionId(event);

				if (openCodeSessionId === undefined) continue;

				this.eventEmitter.emit('opencode.event.received', {
					event,
					openCodeSessionId,
					repositoryName,
				});
			}
		} catch (error) {
			if (this.isAbortError(error)) {
				this.logger.log(`Opencode event stream aborted for ${repositoryName}`);

				return;
			}

			this.logger.error(`Opencode event stream error for ${repositoryName}`, error);

			await this.repository.markSessionsFailed(
				repositoryName,
				`Opencode event stream error: ${error instanceof Error ? error.message : 'unknown'}`
			);
		} finally {
			this.clearStallTimer(repositoryName);

			const current = this.streams.get(repositoryName);

			if (current === state) this.streams.delete(repositoryName);
		}
	}

	private stopStream(repositoryName: string): void {
		const state = this.streams.get(repositoryName);

		if (!state) return;

		state.controller.abort();
	}

	private resetStallTimer(repositoryName: string, state: StreamState): void {
		this.clearStallTimer(repositoryName);

		const timer = setTimeout(() => {
			this.logger.error(`Opencode event stream stalled for ${repositoryName}`);

			state.controller.abort();

			void this.repository.markSessionsFailed(
				repositoryName,
				`The opencode event stream stalled: no events received for ${EVENT_STREAM_STALL_TIMEOUT_MS / MILLISECONDS_PER_SECOND / SECONDS_PER_MINUTE} minutes. The session may be stuck; please try again.`
			);
		}, EVENT_STREAM_STALL_TIMEOUT_MS);

		this.stallTimers.set(repositoryName, timer);
	}

	private clearStallTimer(repositoryName: string): void {
		const timer = this.stallTimers.get(repositoryName);

		if (timer) {
			clearTimeout(timer);
			this.stallTimers.delete(repositoryName);
		}
	}

	private isAbortError(error: unknown): boolean {
		return error instanceof Error && error.name === 'AbortError';
	}
}
