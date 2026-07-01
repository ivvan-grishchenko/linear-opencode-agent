# linear-opencode-agent

A Linear AI agent that codes on assigned issues and assists when mentioned in comments. It bridges Linear's AgentSession protocol to an opencode server that does the actual coding, deployed as a Cloudflare Worker plus a remote opencode server.

## Language

**AgentSession** (Linear):
A Linear object tracking the lifecycle of one agent run on an issue or comment. Created automatically when the agent is mentioned or delegated an issue.
_Avoid_: session (too generic — see opencode session)

**AgentActivity** (Linear):
A progress emission attached to an AgentSession. One of five semantic types: `thought`, `action`, `elicitation`, `response`, `error`. Users see these in the Linear UI.
_Avoid_: message, event, update

**Delegate** (Linear):
The relationship created when an issue is assigned to the agent. The human remains the `assignee`; the agent acts on their behalf as the `delegate`.
_Avoid_: assignee (that's the human owner)

**opencode session**:
A server-side conversation object on the opencode server (`POST /session`). Owns the message history, tool calls, file edits, and shell invocations for one coding task. One opencode session per AgentSession.
_Avoid_: AgentSession (that's Linear's object)

**Part** (opencode):
A typed piece of a message in an opencode session (text, tool call, tool result, reasoning). The unit the Worker translates into AgentActivity emissions.
_Avoid_: chunk, token

**Queue consumer**:
The Cloudflare Queue handler invocation that owns one coding job's full lifetime — from emitting the first `thought` through PR creation. Distinct from the Worker's `fetch()` handler, which validates, creates the opencode session, and enqueues.
_Avoid_: worker (ambiguous — the whole Cloudflare Worker includes both fetch and queue handlers)

**Translator**:
The Worker logic that maps opencode Parts to Linear AgentActivity content payloads. Stateless per-call; lives inside the queue consumer.

**Session map**:
The KV entry binding a Linear AgentSession to its opencode session ID. Written by the `fetch()` handler immediately after creating the opencode session, read by the queue consumer to drive the session. Keyed by the Linear `agentSessionId`; value is the raw opencode session ID. TTL of 30 days; follow-up prompts in a delegation session commit to the same branch/PR the original session created.

**Delegation flow**:
The coding path triggered by issue assignment. The queue consumer drives an existing opencode session with a delegation prompt, the model edits code and opens a PR. Success = PR linked to the AgentSession via `agentSessionUpdateExternalUrl`.
_Avoid_: coding mode, implementation flow

**Mention flow**:
The advisory path triggered by @-mention in a comment. The queue consumer drives a read-only opencode session — read-only enforced at the opencode tool level, not just via prompt instruction — that gathers context from the issue and repo, then answers in a `response` activity. No branch, no git mutations, no PR. Follow-up `prompted` events are also handled as mention flows.
_Avoid_: chat mode, question flow

**OpenSpec change marker**:
An HTML comment `<!-- openspec-change: <change-name> -->` at the top of a Linear issue description that binds the issue to an OpenSpec change directory under `openspec/changes/<change-name>/` in the target repo. The delegation flow extracts this to derive its branch name (`feat/<change-name>`); absence is a hard abort.

**Delegation abort**:
The termination path when the issue description lacks an `openspec-change` marker. The queue consumer emits an `error` activity, removes the agent as delegate, posts a comment @mentioning the user with the explanation, and acknowledges the message. No branch, no status change.

**Session marker**:
KV entries used to guard against duplicate processing. Two markers are written:

- **`webhook:${agentSessionId}`** — written by the `fetch()` handler before resolving the repository or creating the opencode session. Guards against duplicate webhook delivery. TTL of 30 days.
- **`queue:${agentSessionId}`** — written by the queue consumer when it starts processing a job. Guards against duplicate queue messages and Cloudflare retries. TTL of 30 days.

Both markers are independent and intentionally separate: the webhook marker prevents double-enqueue, and the queue marker prevents double-processing.

## Relationships

- A **Delegate** assignment creates one **AgentSession** on Linear.
- One **AgentSession** maps to exactly one **opencode session**.
- The Worker's `fetch()` handler creates the **opencode session** and writes the **session map**, then enqueues the job.
- A **Queue consumer** invocation drives exactly one **opencode session** and emits many **AgentActivities** back to that one **AgentSession**.
- The **Translator** converts each new **Part** in the opencode session into one **AgentActivity**.
- A **Delegation flow** and a **Mention flow** are the only two paths through a **Queue consumer**. The trigger is structural on the initial `created` event: assignment → **Delegation flow**, comment-mention → **Mention flow**. Subsequent `prompted` follow-ups are handled as **Mention flow**.
- No escalation between flows: a mention session never becomes a delegation session and vice versa.

## Example dialogue

> **Dev:** "When I assign issue ENG-42 to the agent, what creates the opencode session?"
> **Domain expert:** "Linear fires a `created` AgentSession webhook. The Worker's `fetch` handler verifies the signature, resolves the repository, calls `POST /session` on the opencode server, writes the **session map** to KV, and enqueues a job. The **queue consumer** wakes, reads the session map, prompts the model, and starts consuming **Parts** from the event stream."
>
> **Dev:** "And if someone @mentions the agent in a comment instead of assigning the issue?"
> **Domain expert:** "Same webhook path — the `fetch` handler still creates the opencode session and enqueues the job. The **queue consumer** sends a shorter, advisory prompt with read-only tools. Both flows share the same handler and consumer."
>
> **Dev:** "What happens to the AgentSession state in Linear?"
> **Domain expert:** "Linear tracks it automatically from the **AgentActivities** we emit. We never mutate session state directly."
>
> **Dev:** "What about follow-up comments?"
> **Domain expert:** "They arrive as `prompted` AgentSession webhooks. The `fetch` handler reuses the existing opencode session from the **session map** and enqueues another job. The consumer treats every `prompted` event as a read-only **Mention flow**."

## Flagged ambiguities

- "session" was used to mean both **AgentSession** (Linear's lifecycle object) and **opencode session** (the coding server's conversation). Resolved: always use the qualified term.
- "the agent" could mean the Cloudflare Worker, the opencode server, or the LLM inside opencode. Resolved: "agent" refers to the whole system as perceived by Linear users; internally we name the components (Worker, opencode server, translator, queue consumer).
- `elicitation` is one of Linear's five AgentActivity types but has no native opencode equivalent (opencode's permission prompts are tool-approval flows, not user questions). Resolved for v1: the agent does not emit `elicitation`. If it needs a decision, it emits a `response` with the question and ends the turn; the user @mentions again to continue, which triggers a `prompted` webhook.
