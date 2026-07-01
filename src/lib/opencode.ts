import type {
	OpencodeClient,
	Part,
	Session,
	TextPartInput,
	Message,
	EventSubscribeData,
	Event,
	AssistantMessage,
} from '@opencode-ai/sdk';

import { createOpencodeClient as createSdkClient } from '@opencode-ai/sdk';

import type { Env } from '../types';

interface PromptOptions {
	tools?: Record<string, boolean>;
}

class OpenCodeAgent {
	private static cache = new Map<string, OpenCodeAgent>();

	private readonly client!: OpencodeClient;

	static reset(): void {
		OpenCodeAgent.cache.clear();
	}

	constructor(env: Env, baseUrl: string) {
		const cached = OpenCodeAgent.cache.get(baseUrl);
		if (cached) return cached;

		const password = env.OPENCODE_SERVER_PASSWORD;
		const username = 'opencode';
		const credentialToken = Buffer.from(`${username}:${password}`).toString('base64');

		this.client = createSdkClient({
			baseUrl,
			fetch: (request) => {
				const { url, ...options } = request;

				return fetch(url, {
					...options,
					headers: { ...options.headers, Authorization: `Basic ${credentialToken}` },
				});
			},
		});

		OpenCodeAgent.cache.set(baseUrl, this);
	}

	public async createSession(title: string): Promise<Session> {
		const response = await this.client.session.create({ body: { title } });

		if (!response.data) throw new Error('Failed to create opencode session: empty response');

		return response.data;
	}

	public async getEventsStream(
		options?: EventSubscribeData
	): Promise<AsyncGenerator<Event, unknown, unknown>> {
		const response = await this.client.event.subscribe(options);

		return response.stream;
	}

	public async getSession(sessionId: string): Promise<Session> {
		const result = await this.client.session.get({ path: { id: sessionId } });

		if (!result.data) throw new Error('Failed to get opencode session: empty response');

		return result.data;
	}

	public async isSessionFinished(sessionId: string): Promise<boolean> {
		const response = await this.client.session.messages({ path: { id: sessionId } });

		if (!response.data) throw new Error('Failed to get opencode session: empty response');

		const lastMessage = response.data.at(-1);

		return (
			!!lastMessage?.info &&
			this.isAssistantMessage(lastMessage.info) &&
			lastMessage.info.time.completed != null
		);
	}

	public async getMessages(sessionId: string): Promise<{ info: Message; parts: Part[] }[]> {
		const response = await this.client.session.messages({ path: { id: sessionId } });

		if (!response.data) return [];

		return response.data;
	}

	public async promptAsync(
		sessionId: string,
		text: string,
		options: PromptOptions = {}
	): Promise<void> {
		const parts: TextPartInput[] = [{ type: 'text', text }];

		await this.client.session.promptAsync({
			path: { id: sessionId },
			body: { parts, tools: options.tools },
		});
	}

	private isAssistantMessage(message: Message): message is AssistantMessage {
		return message.role === 'assistant';
	}
}

export type { PromptOptions };
export { OpenCodeAgent };
