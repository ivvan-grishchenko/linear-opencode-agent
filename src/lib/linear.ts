import { LinearClient, AgentActivityType } from "@linear/sdk";
import type { Env, StoredTokenData } from "../types";

// Linear SDK references process.env when building the User-Agent header.
// Cloudflare Workers do not provide `process` by default, so we provide a
// minimal polyfill before any LinearClient is constructed.
if (typeof globalThis.process === "undefined") {
  // @ts-expect-error Cloudflare Workers do not define `process` globally.
  globalThis.process = { env: {} };
}

const OAUTH_TOKEN_KEY_PREFIX = "linear_oauth_token_";

export function getWorkspaceTokenKey(workspaceId: string): string {
  return `${OAUTH_TOKEN_KEY_PREFIX}${workspaceId}`;
}

export async function getStoredToken(
  env: Env,
  workspaceId: string,
): Promise<StoredTokenData | null> {
  const raw = await env.LINEAR_TOKENS.get(getWorkspaceTokenKey(workspaceId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokenData;
  } catch {
    return null;
  }
}

export async function setStoredToken(
  env: Env,
  workspaceId: string,
  token: StoredTokenData,
): Promise<void> {
  await env.LINEAR_TOKENS.put(
    getWorkspaceTokenKey(workspaceId),
    JSON.stringify(token),
  );
}

export async function createLinearClient(
  env: Env,
  workspaceId: string,
): Promise<LinearClient | null> {
  const tokenData = await getStoredToken(env, workspaceId);
  if (!tokenData) return null;

  // Refresh if expiring within 5 minutes.
  const buffer = 5 * 60 * 1000;
  if (Date.now() >= tokenData.expires_at - buffer) {
    // Token refresh is handled by the OAuth module; here we just fail fast
    // so the consumer can emit a clear error and let the user re-auth.
    return null;
  }

  return new LinearClient({ accessToken: tokenData.access_token });
}

export type ActivityContent =
  | { type: AgentActivityType.Thought; body: string }
  | { type: AgentActivityType.Action; action: string; parameter: string; result?: string }
  | { type: AgentActivityType.Response; body: string }
  | { type: AgentActivityType.Error; body: string };

export async function emitAgentActivity(
  client: LinearClient,
  agentSessionId: string,
  content: ActivityContent,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId,
    content,
  });
}

export async function updateSessionExternalUrl(
  client: LinearClient,
  agentSessionId: string,
  url: string,
): Promise<void> {
  await client.agentSessionUpdateExternalUrl(agentSessionId, {
    externalUrls: [{ label: "Pull Request", url }],
  });
}

export async function removeAgentDelegate(
  client: LinearClient,
  issueId: string,
): Promise<void> {
  await client.updateIssue(issueId, { delegateId: null });
}

export async function postIssueComment(
  client: LinearClient,
  issueId: string,
  body: string,
): Promise<void> {
  await client.createComment({ issueId, body });
}
