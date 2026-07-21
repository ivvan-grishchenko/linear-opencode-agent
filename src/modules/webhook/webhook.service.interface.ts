import type { AgentSessionEventWebhookPayload } from '@linear/sdk';

export interface IWebhookService {
	handleAgentSessionPayload(payload: AgentSessionEventWebhookPayload): Promise<void>;
}
