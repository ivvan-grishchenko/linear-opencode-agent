import type { AgentSessionEventWebhookPayload } from '@linear/sdk';

export interface IAgentSessionEventListener {
	handleAgentSessionEvent(payload: AgentSessionEventWebhookPayload): Promise<void>;
}
