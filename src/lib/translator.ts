import { AgentActivityType } from "@linear/sdk";
import type { Part } from "@opencode-ai/sdk";

const MAX_PARAM_LENGTH = 500;

export interface TranslateContext {
  /** True if this part belongs to a session that has finished successfully. */
  isFinal: boolean;
}

export type LinearActivityContent =
  | { type: AgentActivityType.Thought; body: string }
  | { type: AgentActivityType.Action; action: string; parameter: string; result?: string }
  | { type: AgentActivityType.Response; body: string }
  | { type: AgentActivityType.Error; body: string };

/**
 * Convert a single opencode Part into a Linear AgentActivity content payload.
 * Returns null for parts that should not be surfaced as activities (attachments, etc.).
 */
export function translatePart(
  part: Part,
  context: TranslateContext,
): LinearActivityContent | null {
  switch (part.type) {
    case "text":
      return context.isFinal
        ? { type: AgentActivityType.Response, body: part.text }
        : { type: AgentActivityType.Thought, body: part.text };

    case "reasoning":
      return { type: AgentActivityType.Thought, body: part.text };

    case "tool": {
      const { tool, state } = part;
      switch (state.status) {
        case "pending":
        case "running":
          return {
            type: AgentActivityType.Action,
            action: tool,
            parameter: formatParameter(state.input),
          };
        case "completed":
          return {
            type: AgentActivityType.Action,
            action: tool,
            parameter: formatParameter(state.input),
            result: state.output,
          };
        case "error":
          return {
            type: AgentActivityType.Error,
            body: `Tool ${tool} failed: ${state.error}`,
          };
        default:
          return null;
      }
    }

    case "patch":
      return {
        type: AgentActivityType.Action,
        action: "Edited files",
        parameter: part.files.join(", "),
      };

    case "retry":
      return {
        type: AgentActivityType.Thought,
        body: `Retrying after error (attempt ${part.attempt}): ${part.error.data.message}`,
      };

    case "step-start":
      return { type: AgentActivityType.Thought, body: "Starting next step..." };

    case "step-finish": {
      const { input, output, reasoning, cache } = part.tokens;
      const total = input + output + reasoning + cache.read + cache.write;
      return {
        type: AgentActivityType.Thought,
        body: `Step finished. Tokens used: ${total}`,
      };
    }

    case "file":
    case "subtask":
    case "agent":
    case "snapshot":
    case "compaction":
      // These are internal/contextual and don't map cleanly to user-visible progress.
      return null;

    default:
      return null;
  }
}

function formatParameter(input: Record<string, unknown> | undefined): string {
  if (!input || Object.keys(input).length === 0) return "";
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return "";
  }
  if (serialized.length <= MAX_PARAM_LENGTH) return serialized;
  return `${serialized.slice(0, MAX_PARAM_LENGTH)}...`;
}
