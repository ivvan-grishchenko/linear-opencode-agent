import { type AgentSessionEventWebhookPayload, LinearClient } from '@linear/sdk';
import { AgentActivityType } from '@linear/sdk';

import type { CodingTaskMessage, Env } from '../types';

import { emitAgentActivity, postIssueComment, removeAgentDelegate } from './linear';
import { Mapping } from './mapping';
import { getOAuthToken } from './oauth';
import { OpenCodeAgent } from './opencode';

const SESSION_MARKER_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Handle an incoming AgentSessionEvent webhook.
 * Returns a response quickly (within Linear's 5-second ack window) and may
 * emit an initial thought activity for `created` events.
 */
export async function handleAgentSessionWebhook(
	env: Env,
	payload: AgentSessionEventWebhookPayload
): Promise<void> {
	console.log('Handling payload', payload);

	const agentSessionId = payload.agentSession.id;
	const issueId = payload.agentSession.issueId;

	const webhookKey = `webhook:${agentSessionId}`;
	const existingWebhook = await env.SESSION_STATE.get(webhookKey);

	if (existingWebhook) return;

	await env.SESSION_STATE.put(
		webhookKey,
		JSON.stringify({ kind: 'marker', queuedAt: Date.now() }),
		{ expirationTtl: SESSION_MARKER_TTL_SECONDS }
	);

	const token = await getOAuthToken(env, payload.organizationId);

	if (!token) {
		console.error('Linear OAuth token not found');
		return;
	}

	const linearClient = new LinearClient({ accessToken: token });
	const resolveResponse = await Mapping.resolveRepositoryName(env, linearClient, payload);

	if (!resolveResponse) {
		console.error('Unable to resolve repository name');

		await emitAgentActivity(linearClient, agentSessionId, {
			type: AgentActivityType.Error,
			body: 'This Linear project is not mapped to an opencode repository. Add a mapping to REPO_MAP and try again.',
		});

		if (issueId) {
			await Promise.all([
				postIssueComment(
					linearClient,
					issueId,
					'Agent could not start: no opencode repository mapping found for this project.'
				),
				removeAgentDelegate(linearClient, issueId),
			]);
		}

		return;
	}

	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Thought,
		body: 'Resolved repository name',
	});

	const { repositoryName, issue } = resolveResponse;
	const agentBaseUrl = `${env.OPENCODE_SERVER_URL}/${repositoryName}`;
	const agent = new OpenCodeAgent(env, agentBaseUrl);

	const openCodeSessionId = await getOpenCodeSessionId(env, payload, issue.title, agent);
	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Thought,
		body: `Created OpenCode session. ${openCodeSessionId}`,
	});

	const task: CodingTaskMessage = {
		action: payload.action === 'created' ? 'created' : 'prompted',
		agentSessionId,
		organizationId: payload.organizationId,
		issueId: issue.id,
		payload,
		openCodeBaseUrl: agentBaseUrl,
		openCodeSessionId,
	};

	await env.CODING_TASKS.send(task);
	await emitAgentActivity(linearClient, agentSessionId, {
		type: AgentActivityType.Thought,
		body: "Queued — I'll start working on this shortly.",
	});
}

async function getOpenCodeSessionId(
	env: Env,
	payload: AgentSessionEventWebhookPayload,
	title: string,
	agent: OpenCodeAgent
): Promise<string> {
	const agentSessionId = payload.agentSession.id;
	const raw = await env.SESSION_STATE.get(agentSessionId);

	if (raw) return raw;

	const session = await agent.createSession(title);

	await env.SESSION_STATE.put(agentSessionId, session.id);

	return session.id;
}
