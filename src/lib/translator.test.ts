import { describe, expect, it } from "vitest";
import { AgentActivityType } from "@linear/sdk";
import { translatePart } from "./translator";
import type { Part } from "@opencode-ai/sdk";

const basePart = {
  id: "p1",
  sessionID: "s1",
  messageID: "m1",
};

describe("translatePart", () => {
  it("maps non-final text to thought", () => {
    const part: Part = { ...basePart, type: "text", text: "Thinking..." };
    const result = translatePart(part, { isFinal: false });
    expect(result).toEqual({
      type: AgentActivityType.Thought,
      body: "Thinking...",
    });
  });

  it("maps final text to response", () => {
    const part: Part = { ...basePart, type: "text", text: "Done!" };
    const result = translatePart(part, { isFinal: true });
    expect(result).toEqual({
      type: AgentActivityType.Response,
      body: "Done!",
    });
  });

  it("maps reasoning to thought", () => {
    const part: Part = {
      ...basePart,
      type: "reasoning",
      text: "I should check the config file.",
      time: { start: 1 },
    };
    const result = translatePart(part, { isFinal: false });
    expect(result).toEqual({
      type: AgentActivityType.Thought,
      body: "I should check the config file.",
    });
  });

  it("maps running tool to action without result", () => {
    const part: Part = {
      ...basePart,
      type: "tool",
      callID: "c1",
      tool: "read",
      state: {
        status: "running",
        input: { path: "src/index.ts" },
        time: { start: 1 },
      },
    };
    const result = translatePart(part, { isFinal: false });
    expect(result).toEqual({
      type: AgentActivityType.Action,
      action: "read",
      parameter: '{"path":"src/index.ts"}',
    });
  });

  it("maps completed tool to action with result", () => {
    const part: Part = {
      ...basePart,
      type: "tool",
      callID: "c1",
      tool: "read",
      state: {
        status: "completed",
        input: { path: "src/index.ts" },
        output: "export default {}",
        title: "Read file",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    };
    const result = translatePart(part, { isFinal: false });
    expect(result).toEqual({
      type: AgentActivityType.Action,
      action: "read",
      parameter: '{"path":"src/index.ts"}',
      result: "export default {}",
    });
  });

  it("maps errored tool to error activity", () => {
    const part: Part = {
      ...basePart,
      type: "tool",
      callID: "c1",
      tool: "shell",
      state: {
        status: "error",
        input: { command: "git push" },
        error: "Authentication failed",
        time: { start: 1, end: 2 },
      },
    };
    const result = translatePart(part, { isFinal: false });
    expect(result).toEqual({
      type: AgentActivityType.Error,
      body: "Tool shell failed: Authentication failed",
    });
  });

  it("truncates long parameters", () => {
    const longInput = { code: "a".repeat(1000) };
    const part: Part = {
      ...basePart,
      type: "tool",
      callID: "c1",
      tool: "edit",
      state: {
        status: "running",
        input: longInput,
        time: { start: 1 },
      },
    };
    const result = translatePart(part, { isFinal: false });
    expect(result).toMatchObject({
      type: AgentActivityType.Action,
      action: "edit",
    });
    expect((result as any).parameter.length).toBe(503);
    expect((result as any).parameter.endsWith("...")).toBe(true);
  });

  it("ignores file attachments", () => {
    const part: Part = {
      ...basePart,
      type: "file",
      mime: "text/plain",
      url: "file://tmp",
    };
    expect(translatePart(part, { isFinal: false })).toBeNull();
  });
});
