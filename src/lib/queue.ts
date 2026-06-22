import type { AgentSessionEventWebhookPayload } from "@linear/sdk";
import { AgentActivityType } from "@linear/sdk";
import type { CodingTaskMessage, Env, OpenSpecParseResult } from "../types";
import {
  buildDelegationPrompt,
  buildMentionPrompt,
  MENTION_READ_ONLY_TOOLS,
} from "./prompts";
import {
  createLinearClient,
  emitAgentActivity,
  postIssueComment,
  removeAgentDelegate,
  updateSessionExternalUrl,
} from "./linear";
import {
  createOpencodeClient,
  createOpencodeSession,
  getOpencodeSession,
  listOpencodeSessionMessages,
  promptOpencodeSessionAsync,
} from "./opencode";
import { translatePart, type LinearActivityContent } from "./translator";

const POLL_INTERVAL_MS = 5000;
const OPENCODE_CONNECT_RETRIES = 2;
const OPENCODE_RETRY_DELAY_MS = 5000;
const SESSION_MAP_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Process one queue message. This is the long-running orchestrator.
 */
export async function processCodingTask(
  message: CodingTaskMessage,
  env: Env,
): Promise<void> {
  const { action, agentSessionId, organizationId, payload } = message;

  const linearClient = await createLinearClient(env, organizationId);
  if (!linearClient) {
    // OAuth token missing or expired. Nothing we can do in the queue.
    console.error(`No Linear token for workspace ${organizationId}`);
    return;
  }

  if (action === "created") {
    await handleCreatedTask(env, linearClient, agentSessionId, payload);
  } else {
    await handlePromptedTask(env, linearClient, agentSessionId, payload);
  }
}

async function handleCreatedTask(
  env: Env,
  linearClient: import("@linear/sdk").LinearClient,
  agentSessionId: string,
  payload: AgentSessionEventWebhookPayload,
): Promise<void> {
  const issueId = payload.agentSession.issue?.id;
  const isMention = payload.agentSession.comment != null;

  // Deduplicate at consumer level too (covers KV race / stale messages).
  const mapKey = getSessionMapKey(agentSessionId);
  const existingMap = await env.SESSION_STATE.get(mapKey);
  if (existingMap) {
    await emitAgentActivity(linearClient, agentSessionId, {
      type: AgentActivityType.Thought,
      body: "This session has already been processed. Skipping duplicate job.",
    });
    return;
  }

  const opencodeClient = createOpencodeClient(env);

  // For delegation, verify the OpenSpec change marker and directory first.
  let prompt: string;
  let tools: Record<string, boolean> | undefined;
  if (isMention) {
    prompt = buildMentionPrompt(payload);
    tools = MENTION_READ_ONLY_TOOLS;
  } else {
    const openSpecResult = await parseAndVerifyOpenSpecChange(
      opencodeClient,
      payload,
    );
    if (!openSpecResult.ok) {
      await abortDelegation(
        linearClient,
        agentSessionId,
        issueId,
        openSpecResult.message,
      );
      return;
    }
    prompt = buildDelegationPrompt(payload, openSpecResult.change);
  }

  // Create the opencode session and persist the mapping.
  const opencodeSessionId = await withOpencodeRetry(() =>
    createOpencodeSession(opencodeClient, `linear-${agentSessionId}`),
  );

  await env.SESSION_STATE.put(
    mapKey,
    JSON.stringify({
      kind: "map",
      opencodeSessionId,
      opencodeServerUrl: env.OPENCODE_SERVER_URL,
      createdAt: Date.now(),
    }),
    { expirationTtl: SESSION_MAP_TTL_SECONDS },
  );

  await emitAgentActivity(linearClient, agentSessionId, {
    type: AgentActivityType.Thought,
    body: isMention
      ? "Looking into your question..."
      : "Starting implementation...",
  });

  await withOpencodeRetry(() =>
    promptOpencodeSessionAsync(opencodeClient, opencodeSessionId, prompt, {
      tools,
    }),
  );

  await pollAndTranslate(
    env,
    linearClient,
    opencodeClient,
    agentSessionId,
    opencodeSessionId,
  );
}

async function handlePromptedTask(
  env: Env,
  linearClient: import("@linear/sdk").LinearClient,
  agentSessionId: string,
  payload: AgentSessionEventWebhookPayload,
): Promise<void> {
  const mapKey = getSessionMapKey(agentSessionId);
  const rawMap = await env.SESSION_STATE.get(mapKey);
  if (!rawMap) {
    await emitAgentActivity(linearClient, agentSessionId, {
      type: AgentActivityType.Error,
      body: "Could not find an existing opencode session for this conversation.",
    });
    return;
  }

  const map = JSON.parse(rawMap) as {
    opencodeSessionId: string;
    opencodeServerUrl: string;
  };

  // If the session was created against a different opencode server (e.g. repo
  // moved), we can't safely resume. This is a v1 limitation.
  if (map.opencodeServerUrl !== env.OPENCODE_SERVER_URL) {
    await emitAgentActivity(linearClient, agentSessionId, {
      type: AgentActivityType.Error,
      body: "This session was started on a different opencode server and cannot be resumed here.",
    });
    return;
  }

  const opencodeClient = createOpencodeClient(env);
  const followUp = extractFollowUp(payload);
  const isMention = payload.agentSession.comment != null;

  await emitAgentActivity(linearClient, agentSessionId, {
    type: AgentActivityType.Thought,
    body: "Resuming session with your follow-up...",
  });

  await withOpencodeRetry(() =>
    promptOpencodeSessionAsync(
      opencodeClient,
      map.opencodeSessionId,
      followUp,
      isMention ? { tools: MENTION_READ_ONLY_TOOLS } : {},
    ),
  );

  await pollAndTranslate(
    env,
    linearClient,
    opencodeClient,
    agentSessionId,
    map.opencodeSessionId,
  );
}

/**
 * Poll the opencode session for new messages, translate parts to Linear
 * activities, and stop when the session is no longer running.
 */
async function pollAndTranslate(
  env: Env,
  linearClient: import("@linear/sdk").LinearClient,
  opencodeClient: import("@opencode-ai/sdk").OpencodeClient,
  agentSessionId: string,
  opencodeSessionId: string,
): Promise<void> {
  let lastSeenMessageId: string | null = null;
  let lastSeenPartId: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(POLL_INTERVAL_MS);

    let session;
    try {
      session = await getOpencodeSession(opencodeClient, opencodeSessionId);
    } catch (err) {
      console.error("Failed to fetch opencode session status:", err);
      continue;
    }

    let messages;
    try {
      messages = await listOpencodeSessionMessages(
        opencodeClient,
        opencodeSessionId,
      );
    } catch (err) {
      console.error("Failed to fetch opencode messages:", err);
      continue;
    }

    const isComplete = isSessionComplete(session);

    for (const message of messages) {
      // Skip messages already seen in full.
      if (
        lastSeenMessageId &&
        message.info.id !== lastSeenMessageId &&
        !isNewerMessage(message.info.id, lastSeenMessageId, messages)
      ) {
        continue;
      }

      for (const part of message.parts) {
        if (lastSeenPartId && part.id <= lastSeenPartId) continue;

        const activity = translatePart(part, { isFinal: isComplete });
        if (activity) {
          await emitAgentActivity(linearClient, agentSessionId, activity);
        }

        lastSeenPartId = part.id;
      }

      lastSeenMessageId = message.info.id;
    }

    if (isComplete) {
      const finalText = findFinalText(messages);
      const prUrl = extractPrUrl(finalText);
      if (prUrl) {
        await updateSessionExternalUrl(linearClient, agentSessionId, prUrl);
      }
      return;
    }
  }
}

function isSessionComplete(session: unknown): boolean {
  // Defensive: the opencode session object shape may vary. Treat any status
  // that isn't explicitly "running" as complete.
  if (!session || typeof session !== "object") return true;
  const status = (session as { status?: { type?: string } }).status;
  if (!status) return true;
  return status.type !== "running" && status.type !== "busy";
}

function isNewerMessage(
  candidateId: string,
  referenceId: string,
  messages: { info: { id: string } }[],
): boolean {
  const ids = messages.map((m) => m.info.id);
  const candidateIndex = ids.indexOf(candidateId);
  const referenceIndex = ids.indexOf(referenceId);
  if (candidateIndex === -1 || referenceIndex === -1) return false;
  return candidateIndex > referenceIndex;
}

function findFinalText(
  messages: { info: { id: string }; parts: import("@opencode-ai/sdk").Part[] }[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    for (let j = message.parts.length - 1; j >= 0; j--) {
      const part = message.parts[j];
      if (part && part.type === "text") {
        return part.text;
      }
    }
  }
  return "";
}

function extractPrUrl(text: string): string | null {
  const match = text.match(
    /https:\/\/github\.com\/[^\s\/]+\/[^\s\/]+\/pull\/\d+/,
  );
  return match?.[0] ?? null;
}

async function parseAndVerifyOpenSpecChange(
  opencodeClient: import("@opencode-ai/sdk").OpencodeClient,
  payload: AgentSessionEventWebhookPayload,
): Promise<OpenSpecParseResult> {
  const description = payload.agentSession.issue?.description ?? "";
  const match = description.match(
    /<!--\s*openspec-change:\s*([^\s]+)\s*-->/,
  );
  if (!match?.[1]) {
    return {
      ok: false,
      reason: "missing-marker",
      message:
        "No `<!-- openspec-change: <name> -->` marker found in the issue description.",
    };
  }

  const name = match[1];
  const change = {
    name,
    branchName: `feat/${name}`,
    directoryPath: `openspec/changes/${name}`,
  };

  const exists = await verifyDirectoryExists(
    opencodeClient,
    change.directoryPath,
  );
  if (!exists) {
    return {
      ok: false,
      reason: "missing-directory",
      message: `OpenSpec change directory \`openspec/changes/${name}\` not found in the repo. Run \`openspec create ${name}\` locally and push, then re-assign this issue.`,
    };
  }

  return { ok: true, change };
}

async function verifyDirectoryExists(
  opencodeClient: import("@opencode-ai/sdk").OpencodeClient,
  path: string,
): Promise<boolean> {
  try {
    const result = await opencodeClient.file.list({ query: { path } });
    const entries = result.data;
    return Array.isArray(entries) && entries.length > 0;
  } catch {
    return false;
  }
}

function extractFollowUp(
  payload: AgentSessionEventWebhookPayload,
): string {
  const content = (payload as { agentActivity?: { content?: unknown } }).agentActivity?.content;
  if (content && typeof content === "object" && "body" in content) {
    const body = (content as { body?: unknown }).body;
    return typeof body === "string" ? body : "";
  }
  return "";
}

async function abortDelegation(
  linearClient: import("@linear/sdk").LinearClient,
  agentSessionId: string,
  issueId: string | undefined,
  message: string,
): Promise<void> {
  await emitAgentActivity(linearClient, agentSessionId, {
    type: AgentActivityType.Error,
    body: message,
  });

  if (issueId) {
    try {
      await postIssueComment(
        linearClient,
        issueId,
        `Agent could not start: ${message}`,
      );
      await removeAgentDelegate(linearClient, issueId);
    } catch (err) {
      console.error("Failed to clean up issue after abort:", err);
    }
  }
}

async function withOpencodeRetry<T>(
  fn: () => Promise<T>,
  retries = OPENCODE_CONNECT_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries) {
        await sleep(OPENCODE_RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

function getSessionMapKey(agentSessionId: string): string {
  return `map:${agentSessionId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
