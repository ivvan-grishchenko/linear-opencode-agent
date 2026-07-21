import type { ILinearService } from '@modules/linear';
import type { IOpencodeService } from '@modules/opencode';
import type { Event } from '@opencode-ai/sdk';

import { AgentActivityType } from '@linear/sdk';
import { LinearInject } from '@modules/linear';
import { OpencodeInject } from '@modules/opencode';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
	IOpencodeEventMapperService,
	IOpencodeEventProcessor,
	IOpencodeEventRepository,
	IOpencodeEventStreamService,
} from '../interface';
import type {
	OpencodeEventReceived,
	ResolvedSession,
	TranslateContext,
} from '../opencode-events.type';

import { OpencodeEventsInject } from '../opencode-events.enum';

@Injectable()
export class OpencodeEventProcessor implements IOpencodeEventProcessor {
	private readonly logger = new Logger(OpencodeEventProcessor.name);
	private readonly emittedParts = new Map<string, Set<string>>();

	constructor(
		@Inject(OpencodeEventsInject.STREAM_SERVICE)
		private readonly streamService: IOpencodeEventStreamService,
		@Inject(OpencodeEventsInject.MAPPER_SERVICE)
		private readonly mapperService: IOpencodeEventMapperService,
		@Inject(OpencodeEventsInject.REPOSITORY)
		private readonly repository: IOpencodeEventRepository,

		@Inject(LinearInject.SERVICE)
		private readonly linearService: ILinearService,
		@Inject(OpencodeInject.SERVICE)
		private readonly opencodeService: IOpencodeService
	) {}

	async processEvent(event: OpencodeEventReceived): Promise<void> {
		const session = await this.repository.findSession(event.openCodeSessionId);

		if (!session) {
			this.logger.warn('No agent session found for opencode event', {
				openCodeSessionId: event.openCodeSessionId,
				repositoryName: event.repositoryName,
				type: event.event.type,
			});

			return;
		}

		switch (event.event.type) {
			case 'message.part.updated': {
				await this.handleMessagePartUpdated(session, event.event);
				break;
			}

			case 'session.idle': {
				await this.handleSessionIdle(session);
				break;
			}

			case 'session.error': {
				await this.handleSessionError(session, event.event);
				break;
			}
		}
	}

	private async handleMessagePartUpdated(
		session: ResolvedSession,
		event: Extract<Event, { type: 'message.part.updated' }>
	): Promise<void> {
		const { part } = event.properties;

		if (part.type === 'text') return;

		if (part.type === 'tool' && part.state.status === 'running') return;

		const key = part.type === 'tool' ? `${part.id}:${part.state.status}` : part.id;

		if (this.isEmitted(session.agentSessionId, key)) return;
		this.markEmitted(session.agentSessionId, key);

		const context: TranslateContext = { isFinal: false };
		const content = this.mapperService.translatePart(part, context);

		if (content)
			await this.linearService.emitAgentActivity(session.client, session.agentSessionId, content);
	}

	private async handleSessionIdle(session: ResolvedSession): Promise<void> {
		const isFinished = await this.opencodeService.isSessionFinished(
			session.repositoryName,
			session.openCodeSessionId
		);

		if (!isFinished) return;

		await this.emitFinalText(session);

		await this.repository.updateStatus(session.agentSessionId, 'completed');
		this.clearEmitted(session.agentSessionId);
		this.streamService.releaseStream(session.repositoryName);
	}

	private async handleSessionError(
		session: ResolvedSession,
		event: Extract<Event, { type: 'session.error' }>
	): Promise<void> {
		const errorProp = event.properties.error;

		await this.linearService.emitAgentActivity(session.client, session.agentSessionId, {
			body: this.formatSessionError(errorProp),
			type: AgentActivityType.Error,
		});

		await this.repository.updateStatus(
			session.agentSessionId,
			'failed',
			this.formatSessionError(errorProp)
		);
		this.clearEmitted(session.agentSessionId);
		this.streamService.releaseStream(session.repositoryName);
	}

	private async emitFinalText(session: ResolvedSession): Promise<void> {
		const messages = await this.opencodeService.getMessages(
			session.repositoryName,
			session.openCodeSessionId
		);

		const textParts = messages
			.filter(({ info }) => info.role === 'assistant')
			.flatMap(({ parts }) => parts)
			.filter((part) => part.type === 'text');

		const contents = textParts.map((part, index) =>
			this.mapperService.translatePart(part, { isFinal: index === textParts.length - 1 })
		);

		await Promise.all(
			contents
				.filter((content): content is NonNullable<typeof content> => content !== null)
				.map((content) =>
					this.linearService.emitAgentActivity(session.client, session.agentSessionId, content)
				)
		);

		if (session.mode === 'delegation') {
			const finalPart = textParts[textParts.length - 1] as { text: string } | undefined;
			const prUrl = this.extractPrUrl(finalPart?.text ?? '');

			if (prUrl)
				await this.linearService.updateSessionExternalUrl(
					session.client,
					session.agentSessionId,
					prUrl
				);
		}
	}

	private extractPrUrl(text: string): string | null {
		const match = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/.exec(text);

		return match?.[0] ?? null;
	}

	private formatSessionError(
		error: { name: string; data: { message?: string } } | undefined
	): string {
		if (!error) return 'Session encountered an unknown error';

		const message = typeof error.data?.message === 'string' ? error.data.message : error.name;

		return `Session error: ${message}`;
	}

	private isEmitted(agentSessionId: string, key: string): boolean {
		return this.emittedParts.get(agentSessionId)?.has(key) ?? false;
	}

	private markEmitted(agentSessionId: string, key: string): void {
		let set = this.emittedParts.get(agentSessionId);

		if (!set) {
			set = new Set<string>();
			this.emittedParts.set(agentSessionId, set);
		}

		set.add(key);
	}

	private clearEmitted(agentSessionId: string): void {
		this.emittedParts.delete(agentSessionId);
	}
}
