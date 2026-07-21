import type { AgentSessionEventWebhookPayload, Issue, LinearClient } from '@linear/sdk';

interface AgentSessionCreatedEvent {
	agentSessionId: string;
	client: LinearClient;
	issue: Issue;
	issueId: string;
	issueTitle: string;
	mode: 'delegation' | 'mention';
	openCodeSessionId: string;
	payload: AgentSessionEventWebhookPayload;
	repositoryName: string;
}

interface AgentSessionPromptedEvent {
	agentSessionId: string;
	client: LinearClient;
	issueId: string;
	issueTitle: string;
	mode: 'delegation' | 'mention';
	openCodeSessionId: string;
	payload: AgentSessionEventWebhookPayload;
	repositoryName: string;
}

interface EventValidatePayload {
	client: LinearClient;
	issue: Issue;
	issueId: string;
	issueTitle: string;
	repositoryName: string;
}

interface OpenSpecChange {
	branchName: string;
	directoryPath: string;
	name: string;
}

interface OpenSpecParseSuccess {
	change: OpenSpecChange;
	ok: true;
}

interface OpenSpecParseFailure {
	message: string;
	ok: false;
	reason: 'missing-marker';
}

type OpenSpecParseResult = OpenSpecParseSuccess | OpenSpecParseFailure;

export type {
	AgentSessionCreatedEvent,
	AgentSessionPromptedEvent,
	EventValidatePayload,
	OpenSpecChange,
	OpenSpecParseResult,
};
