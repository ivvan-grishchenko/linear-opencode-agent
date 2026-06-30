import type { AgentSessionEventWebhookPayload, LinearClient } from '@linear/sdk';
import type { OpencodeClient, Part } from '@opencode-ai/sdk';

import { AgentActivityType } from '@linear/sdk';

import type { CodingTaskMessage, Env, OpenSpecParseResult } from '../types';

import {
	createLinearClient,
	emitAgentActivity,
	postIssueComment,
	removeAgentDelegate,
	updateSessionExternalUrl,
} from './linear';
import {
	createOpencodeClient,
	createOpencodeSession,
	getOpencodeSession,
	listOpencodeSessionMessages,
	promptOpencodeSessionAsync,
} from './opencode';
import { buildDelegationPrompt, buildMentionPrompt, MENTION_READ_ONLY_TOOLS } from './prompts';
import { translatePart } from './translator';
import { Utils } from './utils';

const POLL_INTERVAL_MS = 5000;
const OPENCODE_CONNECT_RETRIES = 2;
const OPENCODE_RETRY_DELAY_MS = 5000;
const SESSION_MAP_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Process one queue message. This is the long-running orchestrator.
 */
export async function processCodingTask(message: CodingTaskMessage, env: Env): Promise<void> {
	const { action, agentSessionId, organizationId, payload } = message;

	const linearClient = await createLinearClient(env, organizationId);
	if (!linearClient) {
		// OAuth token missing or expired. Nothing we can do in the queue.
		console.error(`No Linear token for workspace ${organizationId}`);
		return;
	}

	switch (action) {
		case 'created': {
			await handleCreatedTask(
				env,
				linearClient,
				agentSessionId,
				message.opencodeServerUrl,
				payload
			);
			break;
		}
		case 'prompted': {
			await handlePromptedTask(env, linearClient, agentSessionId, payload);
			break;
		}
	}
}

async function handleCreatedTask(
	env: Env,
	linearClient: LinearClient,
	agentSessionId: string,
	opencodeServerUrl: string | undefined,
	payload: AgentSessionEventWebhookPayload
): Promise<void> {
	const issueId = payload.agentSession.issue?.id;
	const isMention = Boolean(payload.agentSession.comment);

	// Deduplicate at consumer level too (covers KV race / stale messages).
	const mapKey = getSessionMapKey(agentSessionId);
	const existingMap = await env.SESSION_STATE.get(mapKey);
	if (existingMap) {
		await emitAgentActivity(linearClient, agentSessionId, {
			type: AgentActivityType.Thought,
			body: 'This session has already been processed. Skipping duplicate job.',
		});
		return;
	}

	if (!opencodeServerUrl) {
		await emitAgentActivity(linearClient, agentSessionId, {
			type: AgentActivityType.Error,
			body: 'Missing opencode server URL in queue message. This is an internal error.',
		});
		return;
	}

	const opencodeClient = createOpencodeClient(env, opencodeServerUrl);

	// For delegation, verify the OpenSpec change marker and directory first.
	let prompt: string;
	let tools: Record<string, boolean> | undefined;
	if (isMention) {
		prompt = buildMentionPrompt(payload);
		tools = MENTION_READ_ONLY_TOOLS;
	} else {
		const openSpecResult = await parseOpenSpecChange(payload);
		if (!openSpecResult.ok) {
			await abortDelegation(linearClient, agentSessionId, issueId, openSpecResult.message);
			return;
		}
		prompt = buildDelegationPrompt(payload, openSpecResult.change);
	}

	// Create the opencode session and persist the mapping.
	const opencodeSessionId = await Utils.runWithRetry(
		() => createOpencodeSession(opencodeClient, `linear-${agentSessionId}`),
		OPENCODE_CONNECT_RETRIES,
		OPENCODE_RETRY_DELAY_MS
	);

	await env.SESSION_STATE.put(
		mapKey,
		JSON.stringify({
			kind: 'map',
			opencodeSessionId,
			opencodeServerUrl,
			createdAt: Date.now(),
		}),
		{ expirationTtl: SESSION_MAP_TTL_SECONDS }
	);

	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Thought,
		body: isMention ? 'Looking into your question...' : 'Starting implementation...',
	});

	await Utils.runWithRetry(
		() =>
			promptOpencodeSessionAsync(opencodeClient, opencodeSessionId, prompt, {
				tools,
			}),
		OPENCODE_CONNECT_RETRIES,
		OPENCODE_RETRY_DELAY_MS
	);

	await pollAndTranslate(linearClient, opencodeClient, agentSessionId, opencodeSessionId);
}

async function handlePromptedTask(
	env: Env,
	linearClient: LinearClient,
	agentSessionId: string,
	payload: AgentSessionEventWebhookPayload
): Promise<void> {
	const mapKey = getSessionMapKey(agentSessionId);
	const rawMap = await env.SESSION_STATE.get(mapKey);
	if (!rawMap) {
		await emitAgentActivity(linearClient, agentSessionId, {
			type: AgentActivityType.Error,
			body: 'Could not find an existing opencode session for this conversation.',
		});
		return;
	}

	const map = JSON.parse(rawMap) as {
		opencodeSessionId: string;
		opencodeServerUrl: string;
	};

	const opencodeClient = createOpencodeClient(env, map.opencodeServerUrl);
	const followUp = extractFollowUp(payload);
	const isMention = Boolean(payload.agentSession.comment);

	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Thought,
		body: 'Resuming session with your follow-up...',
	});

	await Utils.runWithRetry(
		() =>
			promptOpencodeSessionAsync(
				opencodeClient,
				map.opencodeSessionId,
				followUp,
				isMention ? { tools: MENTION_READ_ONLY_TOOLS } : {}
			),
		OPENCODE_CONNECT_RETRIES,
		OPENCODE_RETRY_DELAY_MS
	);

	await pollAndTranslate(linearClient, opencodeClient, agentSessionId, map.opencodeSessionId);
}

/**
 * Poll the opencode session for new messages, translate parts to Linear
 * activities, and stop when the session is no longer running.
 */
async function pollAndTranslate(
	linearClient: LinearClient,
	opencodeClient: OpencodeClient,
	agentSessionId: string,
	opencodeSessionId: string
): Promise<void> {
	let lastSeenMessageId: string | null = null;
	let lastSeenPartId: string | null = null;

	while (true) {
		await Utils.sleep(POLL_INTERVAL_MS);

		let session;
		try {
			session = await getOpencodeSession(opencodeClient, opencodeSessionId);
		} catch (err) {
			console.error('Failed to fetch opencode session status:', err);
			continue;
		}

		let messages;
		try {
			messages = await listOpencodeSessionMessages(opencodeClient, opencodeSessionId);
		} catch (err) {
			console.error('Failed to fetch opencode messages:', err);
			continue;
		}

		const isComplete = isSessionComplete(session);

		for (const message of messages) {
			// Skip messages already seen in full.
			const isSeenInFull =
				!!lastSeenMessageId &&
				message.info.id !== lastSeenMessageId &&
				!isNewerMessage(message.info.id, lastSeenMessageId, messages);
			if (isSeenInFull) continue;

			for (const part of message.parts) {
				if (lastSeenPartId && part.id <= lastSeenPartId) continue;

				const activity = translatePart(part, { isFinal: isComplete });
				if (activity) await emitAgentActivity(linearClient, agentSessionId, activity);

				lastSeenPartId = part.id;
			}

			lastSeenMessageId = message.info.id;
		}

		if (isComplete) {
			const finalText = findFinalText(messages);
			const prUrl = extractPrUrl(finalText);
			if (prUrl) await updateSessionExternalUrl(linearClient, agentSessionId, prUrl);

			return;
		}
	}
}

function isSessionComplete(session: unknown): boolean {
	// Defensive: the opencode session object shape may vary. Treat any status
	// that isn't explicitly "running" as complete.
	if (!session || typeof session !== 'object') return true;
	const status = (session as { status?: { type?: string } }).status;
	if (!status) return true;
	return status.type !== 'running' && status.type !== 'busy';
}

function isNewerMessage(
	candidateId: string,
	referenceId: string,
	messages: { info: { id: string } }[]
): boolean {
	const ids = messages.map((m) => m.info.id);
	const candidateIndex = ids.indexOf(candidateId);
	const referenceIndex = ids.indexOf(referenceId);
	if (candidateIndex === -1 || referenceIndex === -1) return false;
	return candidateIndex > referenceIndex;
}

function findFinalText(messages: { info: { id: string }; parts: Part[] }[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (!message) continue;
		for (let j = message.parts.length - 1; j >= 0; j--) {
			const part = message.parts[j];
			if (part && part.type === 'text') {
				return part.text;
			}
		}
	}
	return '';
}

function extractPrUrl(text: string): string | null {
	const match = text.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/);
	return match?.[0] ?? null;
}

async function parseOpenSpecChange(
	payload: AgentSessionEventWebhookPayload
): Promise<OpenSpecParseResult> {
	const description = payload.agentSession.issue?.description ?? '';
	const match = description.match(/<!--\s*openspec-change:\s*(\S+)\s*-->/);
	if (!match?.[1]) {
		return {
			ok: false,
			reason: 'missing-marker',
			message: 'No `<!-- openspec-change: <name> -->` marker found in the issue description.',
		};
	}

	const name = match[1];
	const change = {
		name,
		branchName: `feat/${name}`,
		directoryPath: `openspec/changes/${name}`,
	};

	return { ok: true, change };
}

function extractFollowUp(payload: AgentSessionEventWebhookPayload): string {
	const content = (payload as { agentActivity?: { content?: unknown } }).agentActivity?.content;
	if (content && typeof content === 'object' && 'body' in content) {
		const body = (content as { body?: unknown }).body;
		return typeof body === 'string' ? body : '';
	}
	return '';
}

async function abortDelegation(
	linearClient: LinearClient,
	agentSessionId: string,
	issueId: string | undefined,
	message: string
): Promise<void> {
	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Error,
		body: message,
	});

	if (!issueId) return;

	try {
		await Promise.all([
			postIssueComment(linearClient, issueId, `Agent could not start: ${message}`),
			removeAgentDelegate(linearClient, issueId),
		]);
	} catch (err) {
		console.error('Failed to clean up issue after abort:', err);
	}
}

function getSessionMapKey(agentSessionId: string): string {
	return `map:${agentSessionId}`;
}
