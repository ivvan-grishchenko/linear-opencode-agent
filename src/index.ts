import { LinearWebhookClient } from '@linear/sdk/webhooks';

import type { Env, CodingTaskMessage } from './types';

import { handleOAuthAuthorize, handleOAuthCallback } from './lib/oauth';
import { processCodingTask } from './lib/queue';
import { handleAgentSessionWebhook } from './lib/webhook';

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

	async queue(batch: MessageBatch<CodingTaskMessage>, env: Env): Promise<void> {
		for (const message of batch.messages) {
			try {
				await processCodingTask(message.body, env);
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
	try {
		if (!env.LINEAR_WEBHOOK_SECRET) {
			return new Response('LINEAR_WEBHOOK_SECRET not configured', {
				status: 500,
			});
		}

		const webhookClient = new LinearWebhookClient(env.LINEAR_WEBHOOK_SECRET);
		const handler = webhookClient.createHandler();

		handler.on('AgentSessionEvent', async (payload) => {
			await handleAgentSessionWebhook(env, payload);
		});

		return await handler(request);
	} catch (error) {
		console.error('Error in webhook handler:', error);
		return new Response('Error handling webhook', { status: 500 });
	}
}
