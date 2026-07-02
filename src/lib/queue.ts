import type { Part } from '@opencode-ai/sdk';

import { type AgentSessionEventWebhookPayload, LinearClient } from '@linear/sdk';
import { AgentActivityType } from '@linear/sdk';

import type { CodingTaskMessage, Env, OpenSpecParseResult } from '../types';

import { extractSessionId } from './events';
import { abortDelegation, emitAgentActivity, updateSessionExternalUrl } from './linear';
import { getOAuthToken } from './oauth';
import { OpenCodeAgent } from './opencode';
import { buildDelegationPrompt, buildMentionPrompt, MENTION_READ_ONLY_TOOLS } from './prompts';
import { translatePart } from './translator';

const SESSION_MAP_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Process one queue message. This is the long-running orchestrator.
 */
export async function processCodingTask(message: CodingTaskMessage, env: Env): Promise<void> {
	console.log('Started processing task');

	const { agentSessionId, openCodeBaseUrl } = message;

	const token = await getOAuthToken(env, message.organizationId);

	if (!token) {
		console.error('Linear OAuth token not found');
		return;
	}

	const linearClient = new LinearClient({ accessToken: token });
	await emitAgentActivity(linearClient, message.agentSessionId, {
		type: AgentActivityType.Thought,
		body: 'Picked up a task from queue',
	});

	// Deduplicate at consumer level too (covers KV race / stale messages).
	const queueKey = `queue:${agentSessionId}`;
	const existingMap = await env.SESSION_STATE.get(queueKey);
	if (existingMap) {
		await emitAgentActivity(linearClient, agentSessionId, {
			type: AgentActivityType.Thought,
			body: 'This session has already been processed. Skipping duplicate job.',
		});
		return;
	}

	await env.SESSION_STATE.put(queueKey, agentSessionId, { expirationTtl: SESSION_MAP_TTL_SECONDS });

	if (!openCodeBaseUrl) {
		await emitAgentActivity(linearClient, agentSessionId, {
			type: AgentActivityType.Error,
			body: 'Missing opencode server URL in queue message. This is an internal error.',
		});
		return;
	}

	const opencodeSessionId = await env.SESSION_STATE.get(agentSessionId);
	if (!opencodeSessionId) {
		console.error('Unable to retrieve open code session id');
		await emitAgentActivity(linearClient, agentSessionId, {
			type: AgentActivityType.Error,
			body: 'Unable to retrieve open code session id.',
		});
		return;
	}

	switch (message.action) {
		case 'created': {
			await handleCreatedTask(env, message, linearClient, opencodeSessionId);
			break;
		}
		case 'prompted': {
			await handlePromptedTask(env, message, linearClient, opencodeSessionId);
			break;
		}
	}
}

async function handleCreatedTask(
	env: Env,
	{ agentSessionId, openCodeBaseUrl, payload, issueId }: CodingTaskMessage,
	linearClient: LinearClient,
	opencodeSessionId: string
): Promise<void> {
	// For delegation, verify the OpenSpec change marker and directory first.
	const openSpecResult = await parseOpenSpecChange(payload);
	if (!openSpecResult.ok) {
		await abortDelegation(linearClient, agentSessionId, issueId, openSpecResult.message);
		return;
	}
	const agent = new OpenCodeAgent(env, openCodeBaseUrl);
	const prompt = buildDelegationPrompt(payload, openSpecResult.change);

	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Thought,
		body: 'Built the prompt. Starting implementation...',
	});

	await agent.promptAsync(opencodeSessionId, prompt);
	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Thought,
		body: 'Prompted the model asynchronously',
	});

	await pollAndTranslate(agent, linearClient, agentSessionId, opencodeSessionId, { linkPr: true });
}

async function handlePromptedTask(
	env: Env,
	{ agentSessionId, openCodeBaseUrl, payload }: CodingTaskMessage,
	linearClient: LinearClient,
	openCodeSessionId: string
): Promise<void> {
	const agent = new OpenCodeAgent(env, openCodeBaseUrl);
	const prompt = buildMentionPrompt(payload);

	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Thought,
		body: 'Starting to process the question',
	});

	await agent.promptAsync(openCodeSessionId, prompt, MENTION_READ_ONLY_TOOLS);

	await pollAndTranslate(agent, linearClient, agentSessionId, openCodeSessionId, { linkPr: false });
}

/**
 * Poll the opencode session for new events, translate parts to Linear
 * activities, and stop when the session finishes.
 *
 * Text parts are deferred to session completion (emitFinalText) to avoid
 * emitting the final answer twice — once as a streaming Thought and again
 * as the final Response. Non-text parts (reasoning, tool calls, patches,
 * step events) are emitted in real time as progress activities.
 */
interface PollOptions {
	/** Whether to extract a PR URL from the final response and link it to the AgentSession. */
	linkPr: boolean;
}

async function pollAndTranslate(
	agent: OpenCodeAgent,
	linearClient: LinearClient,
	agentSessionId: string,
	opencodeSessionId: string,
	options: PollOptions
): Promise<void> {
	const events = await agent.getEventsStream();
	const emitted = new Set<string>();

	for await (const event of events) {
		console.log('Received event', event);
		const eventSessionId = extractSessionId(event);
		if (eventSessionId !== undefined && eventSessionId !== opencodeSessionId) continue;

		switch (event.type) {
			case 'message.part.updated': {
				const part = event.properties.part;

				if (part.type === 'text') break;

				if (part.type === 'tool' && part.state.status === 'running') break;

				const key = part.type === 'tool' ? `${part.id}:${part.state.status}` : part.id;
				if (emitted.has(key)) break;
				emitted.add(key);

				const content = translatePart(part, { isFinal: false });
				if (content) await emitAgentActivity(linearClient, agentSessionId, content);

				break;
			}

			case 'session.idle': {
				const isFinished = await agent.isSessionFinished(opencodeSessionId);
				if (isFinished) {
					await emitFinalText(agent, linearClient, agentSessionId, opencodeSessionId, options);
					return;
				}
				break;
			}

			case 'session.error': {
				const errorProp = event.properties.error;
				await emitAgentActivity(linearClient, agentSessionId, {
					type: AgentActivityType.Error,
					body: formatSessionError(errorProp),
				});
				break;
			}
		}
	}
}

/**
 * Emit the assistant's text parts from the completed session.
 * The last text part becomes a Response (the final answer); earlier text
 * parts become Thoughts (interim narration).
 */
async function emitFinalText(
	agent: OpenCodeAgent,
	linearClient: LinearClient,
	agentSessionId: string,
	opencodeSessionId: string,
	options: PollOptions
): Promise<void> {
	const messages = await agent.getMessages(opencodeSessionId);

	const textParts: Part[] = [];
	for (const { info, parts } of messages) {
		if (info.role !== 'assistant') continue;
		for (const part of parts) {
			if (part.type === 'text') textParts.push(part);
		}
	}

	for (let i = 0; i < textParts.length; i++) {
		const isFinal = i === textParts.length - 1;
		const content = translatePart(textParts[i], { isFinal });
		if (content) await emitAgentActivity(linearClient, agentSessionId, content);
	}

	if (options.linkPr) {
		const finalPart = textParts.at(-1) as { text: string } | undefined;
		const prUrl = extractPrUrl(finalPart?.text ?? '');
		if (prUrl) await updateSessionExternalUrl(linearClient, agentSessionId, prUrl);
	}
}

function extractPrUrl(text: string): string | null {
	const match = text.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/);
	return match?.[0] ?? null;
}

/**
 * Format a session error into a human-readable string.
 * All opencode error variants share a `name` and `data` property; most have
 * `data.message`, while `MessageOutputLengthError` uses an open record.
 */
function formatSessionError(
	error: { name: string; data: { message?: string } } | undefined
): string {
	if (!error) return 'Session encountered an unknown error';
	const message = typeof error.data?.message === 'string' ? error.data.message : error.name;
	return `Session error: ${message}`;
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
