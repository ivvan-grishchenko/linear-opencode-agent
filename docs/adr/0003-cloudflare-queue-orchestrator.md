# Cloudflare Queue as the long-running orchestrator

A Linear coding job runs for minutes to tens of minutes. Cloudflare Worker `fetch()` handlers are capped at 30s wall time even on paid plans, and `ctx.waitUntil()` does not extend that. `session.prompt()` on the opencode SDK is synchronous and blocks for the whole run.

We use a Cloudflare Queue (`queue()` handler) as the orchestrator. The `fetch()` handler receives Linear webhooks, creates the opencode session (`POST /session`) and writes the session map to KV, then enqueues a job in ~100ms (well under the 5-second webhook-ack limit); the queue consumer owns the full job lifetime with unlimited CPU time and wall time measured in minutes. The consumer calls `POST /session/:id/prompt_async` (fire-and-forget) on the opencode server, consumes the event stream for new Parts, translates each to a Linear AgentActivity, and links the resulting PR to the AgentSession.

Rejected alternatives:
- **Cron + KV polling:** works but laggier (30s+ cadence) and requires a KV state machine to track last-seen message IDs across cron invocations. The queue consumer's lifetime *is* the session's lifetime, so that state lives in local variables.
- **Railway-side bridge process holding the SSE stream open:** real-time, but adds a second process to maintain on Railway. The queue consumer already has the wall time budget to poll.
- **Durable Objects holding the SSE connection:** real-time and all-CF, but adds cost and a new mental model for a personal agent.

The queue approach gives built-in retry (failed consumers release the message) and keeps all orchestration in Cloudflare, satisfying the deploy-to-Cloudflare requirement.
