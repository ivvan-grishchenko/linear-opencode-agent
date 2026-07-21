export interface IAgentSessionRepository {
	updateStatus(
		agentSessionId: string,
		status: 'queued' | 'processing' | 'completed' | 'failed',
		errorMessage?: string
	): Promise<void>;
	resolveRepositoryName(organizationId: string, projectId: string | null): Promise<string | null>;
	findOrCreateSession(params: {
		agentSessionId: string;
		issueId: string;
		issueTitle: string;
		mode: 'delegation' | 'mention';
		organizationId: string;
		repositoryName: string;
	}): Promise<{ openCodeBaseUrl: string; openCodeSessionId: string }>;
}
