import type {
	AssistantMessage,
	Event,
	EventSubscribeData,
	Message,
	OpencodeClient,
	Part,
	Session,
	TextPartInput,
} from '@opencode-ai/sdk';

import { createOpencodeClient as createSdkClient } from '@opencode-ai/sdk';

interface PromptOptions {
	tools?: Record<string, boolean>;
}

export class OpenCodeAgent {
	private static readonly cache = new Map<string, OpenCodeAgent>();

	private readonly client!: OpencodeClient;

	static reset(): void {
		OpenCodeAgent.cache.clear();
	}

	constructor(baseUrl: string, password: string) {
		const cached = OpenCodeAgent.cache.get(baseUrl);

		if (cached) return cached;

		const username = 'opencode';
		const credentialToken = Buffer.from(`${username}:${password}`).toString('base64');
		const authorization = `Basic ${credentialToken}`;

		this.client = createSdkClient({
			baseUrl,
			headers: {
				Authorization: authorization,
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
		options?: Partial<EventSubscribeData> & { signal?: AbortSignal }
	): Promise<AsyncGenerator<Event, unknown, unknown>> {
		const response = await this.client.event.subscribe({
			...options,
		});

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

		const messages = response.data;
		const lastMessage = messages[messages.length - 1];

		if (!lastMessage?.info) return false;

		return this.isAssistantMessage(lastMessage.info) && lastMessage.info.time.completed != null;
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
		const parts: TextPartInput[] = [{ text, type: 'text' }];

		await this.client.session.promptAsync({
			body: { parts, tools: options.tools },
			path: { id: sessionId },
		});
	}

	private isAssistantMessage(message: Message): message is AssistantMessage {
		return message.role === 'assistant';
	}
}
