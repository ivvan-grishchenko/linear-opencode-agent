import type { AgentSessionEventWebhookPayload } from "@linear/sdk";
import type { Env } from "./types";
import { handleOAuthAuthorize, handleOAuthCallback } from "./lib/oauth";
import { handleAgentSessionWebhook, verifyWebhook } from "./lib/webhook";
import { processCodingTask } from "./lib/queue";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("linear-opencode-agent is running", { status: 200 });
    }

    if (url.pathname === "/oauth/authorize") {
      return handleOAuthAuthorize(request, env);
    }

    if (url.pathname === "/oauth/callback") {
      return handleOAuthCallback(request, env);
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(
    batch: MessageBatch<Record<string, unknown>>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processCodingTask(message.body as unknown as CodingTaskMessage, env);
        message.ack();
      } catch (err) {
        console.error("Queue consumer failed:", err);
        // Do not ack — let Cloudflare retry. If retries are exhausted the
        // message is dead-lettered (if configured) or dropped.
      }
    }
  },
};

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.LINEAR_WEBHOOK_SECRET) {
    return new Response("LINEAR_WEBHOOK_SECRET not configured", {
      status: 500,
    });
  }

  let payload: AgentSessionEventWebhookPayload;
  try {
    payload = await verifyWebhook(request, env.LINEAR_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook verification failed:", err);
    return new Response("Invalid signature", { status: 401 });
  }

  // Respond quickly; actual work happens in the queue consumer.
  return handleAgentSessionWebhook(env, payload);
}

// Import type after use so the file compiles as a module even if env binding
// types are not yet generated.
import type { CodingTaskMessage } from "./types";
