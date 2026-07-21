import type { Event, Message, Part } from '@opencode-ai/sdk';

export interface IOpencodeService {
	createSession(repositoryName: string, title: string): Promise<string>;
	promptAsync(
		repositoryName: string,
		sessionId: string,
		text: string,
		tools?: Record<string, boolean>
	): Promise<void>;
	getEventsStream(
		repositoryName: string,
		options?: { signal?: AbortSignal }
	): Promise<AsyncGenerator<Event, unknown, unknown>>;
	getMessages(
		repositoryInitializerName: string,
		sessionId: string
	): Promise<{ info: Message; parts: Part[] }[]>;
	isSessionFinished(repositoryName: string, sessionId: string): Promise<boolean>;
	getBaseUrl(repositoryName: string): string;
}
