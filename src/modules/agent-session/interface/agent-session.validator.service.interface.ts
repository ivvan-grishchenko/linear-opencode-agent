import type { AgentSessionEventWebhookPayload } from '@linear/sdk';

import type { EventValidatePayload, OpenSpecParseResult } from '../agent-session.type';

export interface IAgentSessionValidatorService {
	validateEvent(payload: AgentSessionEventWebhookPayload): Promise<EventValidatePayload>;
	parseOpenSpecChange(description: string): OpenSpecParseResult;
}
