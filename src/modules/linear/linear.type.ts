import type { AgentActivityType } from '@linear/sdk';

export type ActivityContent =
	| { type: AgentActivityType.Thought; body: string }
	| { type: AgentActivityType.Action; action: string; parameter: string; result?: string }
	| { type: AgentActivityType.Response; body: string }
	| { type: AgentActivityType.Error; body: string };
