import type { AgentSessionEventWebhookPayload, LinearClient } from '@linear/sdk';

import type { AgentSessionCreatedEvent, AgentSessionPromptedEvent } from '../agent-session.type';

export interface IAgentSessionEventProcessor {
	abort(
		client: LinearClient,
		agentSessionId: string,
		issueId: string | undefined,
		message: string
	): Promise<void>;
	processEvent(payload: AgentSessionEventWebhookPayload): Promise<void>;
	handleCreated(event: AgentSessionCreatedEvent): Promise<void>;
	handlePrompted(event: AgentSessionPromptedEvent): Promise<void>;
}
