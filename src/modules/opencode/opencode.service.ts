import type { ConfigType } from '@nestjs/config';
import type { Event, Message, Part } from '@opencode-ai/sdk';

import { OpencodeConfig } from '@config/opencode.config';
import { Inject, Injectable } from '@nestjs/common';

import type { IOpencodeService } from './opencode.service.interface';

import { OpenCodeAgent } from './opencode-agent';

@Injectable()
export class OpencodeService implements IOpencodeService {
	constructor(
		@Inject(OpencodeConfig.KEY)
		private readonly opencodeConfig: ConfigType<typeof OpencodeConfig>
	) {}

	async createSession(repositoryName: string, title: string): Promise<string> {
		const agent = this.getAgent(repositoryName);
		const session = await agent.createSession(title);

		return session.id;
	}

	async promptAsync(
		repositoryName: string,
		sessionId: string,
		text: string,
		tools?: Record<string, boolean>
	): Promise<void> {
		const agent = this.getAgent(repositoryName);

		await agent.promptAsync(sessionId, text, { tools });
	}

	async getEventsStream(
		repositoryName: string,
		options?: { signal?: AbortSignal }
	): Promise<AsyncGenerator<Event, unknown, unknown>> {
		const agent = this.getAgent(repositoryName);

		return agent.getEventsStream(options);
	}

	async getMessages(
		repositoryName: string,
		sessionId: string
	): Promise<{ info: Message; parts: Part[] }[]> {
		const agent = this.getAgent(repositoryName);

		return agent.getMessages(sessionId);
	}

	async isSessionFinished(repositoryName: string, sessionId: string): Promise<boolean> {
		const agent = this.getAgent(repositoryName);

		return agent.isSessionFinished(sessionId);
	}

	getBaseUrl(repositoryName: string): string {
		const base = this.opencodeConfig.serverUrl.replace(/\/+$/, '');

		return `${base}/${repositoryName.replace(/^\/+/, '')}`;
	}

	private getAgent(repositoryName: string): OpenCodeAgent {
		return new OpenCodeAgent(this.getBaseUrl(repositoryName), this.opencodeConfig.serverPassword);
	}
}
