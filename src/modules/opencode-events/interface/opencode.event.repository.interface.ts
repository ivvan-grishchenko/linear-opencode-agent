import type { ResolvedSession } from '../opencode-events.type';

export interface IOpencodeEventRepository {
	findSession(opencodeSessionId: string): Promise<ResolvedSession | null>;
	updateStatus(
		agentSessionId: string,
		status: 'queued' | 'processing' | 'completed' | 'failed',
		errorMessage?: string
	): Promise<void>;
	markSessionsFailed(repositoryName: string, message: string): Promise<void>;
}
