import type { AgentActivityWebhookPayload, AgentSessionEventWebhookPayload } from '@linear/sdk';

/**
 * Cloudflare Worker environment bindings.
 */
export interface Env {
	// Linear OAuth app credentials
	LINEAR_CLIENT_ID: string;
	LINEAR_CLIENT_SECRET: string;
	LINEAR_WEBHOOK_SECRET: string;

	// This Worker's public URL (for OAuth redirect)
	WORKER_URL: string;

	// Remote opencode server on Railway
	OPENCODE_SERVER_URL: string;
	OPENCODE_SERVER_PASSWORD: string;

	// KV namespaces
	LINEAR_TOKENS: KVNamespace;
	SESSION_STATE: KVNamespace;
	REPO_MAP: KVNamespace;

	// Cloudflare Queue
	CODING_TASKS: Queue<CodingTaskMessage>;
}

/**
 * Message body placed on the CODING_TASKS queue for each AgentSession event.
 */
export interface CodingTaskMessage {
	/** Linear webhook action: 'created' for new sessions, 'prompted' for follow-ups. */
	action: 'created' | 'prompted';
	/** The AgentSession ID from Linear. */
	agentSessionId: string;
	/** The Linear organization/workspace ID. */
	organizationId: string;
	/** The Linear issue ID. */
	issueId: string;
	/** Resolved open code session id for agent session. */
	openCodeSessionId: string;
	/** Resolve open code base url including the correct repository path */
	openCodeBaseUrl: string;
	/** The full webhook payload (serialized). */
	payload:
		| AgentSessionEventWebhookPayload
		| (AgentSessionEventWebhookPayload & { agentActivity: AgentActivityWebhookPayload });
}

/**
 * Stored OAuth token data for a Linear workspace.
 */
export interface StoredTokenData {
	access_token: string;
	refresh_token: string;
	expires_at: number;
}

/**
 * KV shape for the session marker ("job is queued") and session map
 * ("opencode session exists").
 */
export interface SessionMarker {
	kind: 'marker';
	queuedAt: number;
}

export interface SessionMap {
	kind: 'map';
	opencodeSessionId: string;
	opencodeServerUrl: string;
	createdAt: number;
}

/**
 * Parsed result of extracting an OpenSpec change marker from an issue description.
 */
export interface OpenSpecChange {
	name: string;
	branchName: string;
	directoryPath: string;
}

export interface OpenSpecParseSuccess {
	ok: true;
	change: OpenSpecChange;
}

export interface OpenSpecParseFailure {
	ok: false;
	reason: 'missing-marker';
	message: string;
}

export type OpenSpecParseResult = OpenSpecParseSuccess | OpenSpecParseFailure;
