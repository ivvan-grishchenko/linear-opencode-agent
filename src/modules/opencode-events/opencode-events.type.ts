import type { LinearClient } from '@linear/sdk';
import type { Event } from '@opencode-ai/sdk';

interface OpencodeEventReceived {
	event: Event;
	openCodeSessionId: string;
	repositoryName: string;
}
interface TranslateContext {
	isFinal: boolean;
}
interface ResolvedSession {
	agentSessionId: string;
	client: LinearClient;
	mode: 'delegation' | 'mention';
	openCodeSessionId: string;
	repositoryName: string;
}

export type { OpencodeEventReceived, TranslateContext, ResolvedSession };
