import type { AgentSessionEventWebhookPayload } from '@linear/sdk';

import type { OpenSpecChange } from '../agent-session.type';

export interface IAgentSessionPromptService {
	buildDelegationPrompt(webhook: AgentSessionEventWebhookPayload, change: OpenSpecChange): string;
	buildMentionPrompt(webhook: AgentSessionEventWebhookPayload): string;
}
