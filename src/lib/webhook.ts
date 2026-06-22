import type { AgentSessionEventWebhookPayload } from "@linear/sdk";
import type { CodingTaskMessage, Env } from "../types";
import { createLinearClient, emitAgentActivity } from "./linear";
import { AgentActivityType } from "@linear/sdk";

const SESSION_MARKER_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 60 * 1000;

/**
 * Verify a Linear webhook request and return the parsed payload.
 *
 * Uses the Web Crypto API instead of @linear/sdk/webhooks because the SDK's
 * webhook client depends on Node's `crypto` and `Buffer`, which are not
 * available in Cloudflare Workers.
 */
export async function verifyWebhook(
  request: Request,
  secret: string,
): Promise<AgentSessionEventWebhookPayload> {
  const signature = request.headers.get("linear-signature") ?? "";
  const timestampHeader = request.headers.get("linear-timestamp");

  const rawBody = await request.arrayBuffer();
  const isValid = await verifyLinearSignature(
    secret,
    new Uint8Array(rawBody),
    signature,
  );
  if (!isValid) {
    throw new Error("Invalid webhook signature");
  }

  const payload = JSON.parse(
    new TextDecoder().decode(rawBody),
  ) as AgentSessionEventWebhookPayload & { webhookTimestamp?: number };

  const timestamp =
    payload.webhookTimestamp ??
    (timestampHeader ? parseInt(timestampHeader, 10) : NaN);
  if (Number.isNaN(timestamp)) {
    throw new Error("Invalid webhook timestamp");
  }
  if (Math.abs(Date.now() - timestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
    throw new Error("Webhook timestamp too old");
  }

  return payload;
}

async function verifyLinearSignature(
  secret: string,
  body: Uint8Array,
  signature: string,
): Promise<boolean> {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, body);
  const expectedHex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time hex comparison.
  if (expectedHex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= expectedHex.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Handle an incoming AgentSessionEvent webhook.
 * Returns a response quickly (within Linear's 5-second ack window) and may
 * emit an initial thought activity for `created` events.
 */
export async function handleAgentSessionWebhook(
  env: Env,
  payload: AgentSessionEventWebhookPayload,
): Promise<Response> {
  const action = payload.action;
  const agentSessionId = payload.agentSession.id;
  const organizationId = payload.organizationId;

  if (action === "created") {
    const markerKey = getSessionMarkerKey(agentSessionId);
    const existing = await env.SESSION_STATE.get(markerKey);
    if (existing) {
      // Duplicate webhook — already queued.
      return new Response("OK", { status: 200 });
    }

    await env.SESSION_STATE.put(
      markerKey,
      JSON.stringify({ kind: "marker", queuedAt: Date.now() }),
      { expirationTtl: SESSION_MARKER_TTL_SECONDS },
    );

    // Emit an immediate thought so Linear doesn't mark the session unresponsive
    // while the job waits in the queue.
    await emitInitialThought(env, organizationId, agentSessionId);

    const message: CodingTaskMessage = {
      action: "created",
      agentSessionId,
      organizationId,
      payload,
    };
    await env.CODING_TASKS.send(message);
    return new Response("OK", { status: 200 });
  }

  if (action === "prompted") {
    const message: CodingTaskMessage = {
      action: "prompted",
      agentSessionId,
      organizationId,
      payload,
    };
    await env.CODING_TASKS.send(message);
    return new Response("OK", { status: 200 });
  }

  return new Response("Unhandled action", { status: 200 });
}

function getSessionMarkerKey(agentSessionId: string): string {
  return `marker:${agentSessionId}`;
}

async function emitInitialThought(
  env: Env,
  organizationId: string,
  agentSessionId: string,
): Promise<void> {
  const linearClient = await createLinearClient(env, organizationId);
  if (!linearClient) return;

  try {
    await emitAgentActivity(linearClient, agentSessionId, {
      type: AgentActivityType.Thought,
      body: "Queued — I'll start working on this shortly.",
    });
  } catch {
    // Best-effort: don't fail the webhook ack if Linear is unreachable.
  }
}
