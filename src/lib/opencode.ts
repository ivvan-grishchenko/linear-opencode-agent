import { createOpencodeClient as createSdkClient } from "@opencode-ai/sdk";
import type { OpencodeClient, Part, TextPartInput } from "@opencode-ai/sdk";
import type { Env } from "../types";

export function createOpencodeClient(env: Env): OpencodeClient {
  const password = env.OPENCODE_SERVER_PASSWORD;
  const username = "opencode";
  const auth = `Basic ${btoa(`${username}:${password}`)}`;

  return createSdkClient({
    baseUrl: env.OPENCODE_SERVER_URL,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", auth);
      return fetch(input, { ...init, headers });
    },
  });
}

export async function createOpencodeSession(
  client: OpencodeClient,
  title?: string,
): Promise<string> {
  const result = await client.session.create({
    body: title ? { title } : {},
  });
  if (!result.data) {
    throw new Error("Failed to create opencode session: empty response");
  }
  return result.data.id;
}

export interface PromptOptions {
  tools?: Record<string, boolean>;
}

export async function promptOpencodeSessionAsync(
  client: OpencodeClient,
  sessionId: string,
  text: string,
  options: PromptOptions = {},
): Promise<void> {
  const parts: Array<TextPartInput> = [{ type: "text", text }];
  await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      parts,
      tools: options.tools,
    },
  });
}

export async function getOpencodeSession(
  client: OpencodeClient,
  sessionId: string,
) {
  const result = await client.session.get({ path: { id: sessionId } });
  if (!result.data) {
    throw new Error("Failed to get opencode session: empty response");
  }
  return result.data;
}

export async function listOpencodeSessionMessages(
  client: OpencodeClient,
  sessionId: string,
): Promise<{ info: { id: string }; parts: Part[] }[]> {
  const response = await client.session.messages({ path: { id: sessionId } });
  if (!response.data) {
    return [];
  }
  return response.data.map((item) => ({
    info: item.info,
    parts: item.parts,
  }));
}
