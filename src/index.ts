import type { AgentSessionEventWebhookPayload } from '@linear/sdk';

import type { Env } from './types';

import { handleOAuthAuthorize, handleOAuthCallback } from './lib/oauth';
import { processCodingTask } from './lib/queue';
import { handleAgentSessionWebhook, verifyWebhook } from './lib/webhook';

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		switch (url.pathname) {
			case '/':
				return new Response('linear-opencode-agent is running', { status: 200 });
			case '/oauth/authorize':
				return handleOAuthAuthorize(request, env);
			case '/oauth/callback':
				return handleOAuthCallback(request, env);
			case '/webhook': {
				if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
				return handleWebhook(request, env);
			}
			default:
				return new Response('Not found', { status: 404 });
		}
	},

	async queue(batch: MessageBatch<Record<string, unknown>>, env: Env): Promise<void> {
		for (const message of batch.messages) {
			try {
				await processCodingTask(message.body as unknown as CodingTaskMessage, env);
				message.ack();
			} catch (err) {
				console.error('Queue consumer failed:', err);
				// Do not ack — let Cloudflare retry. If retries are exhausted the
				// message is dead-lettered (if configured) or dropped.
			}
		}
	},
};

async function handleWebhook(request: Request, env: Env): Promise<Response> {
	if (!env.LINEAR_WEBHOOK_SECRET) {
		return new Response('LINEAR_WEBHOOK_SECRET not configured', {
			status: 500,
		});
	}

	let payload: AgentSessionEventWebhookPayload;
	try {
		payload = await verifyWebhook(request, env.LINEAR_WEBHOOK_SECRET);
	} catch (err) {
		console.error('Webhook verification failed:', err);
		return new Response('Invalid signature', { status: 401 });
	}

	// Respond quickly; actual work happens in the queue consumer.
	return handleAgentSessionWebhook(env, payload);
}

// Import type after use so the file compiles as a module even if env binding
// types are not yet generated.
import type { CodingTaskMessage } from './types';
