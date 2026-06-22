# linear-opencode-agent

A Linear AI agent that codes on assigned issues and answers questions in comments. It bridges Linear's AgentSession protocol to an [opencode](https://opencode.ai) server running on Railway, orchestrated by a Cloudflare Worker.

## What it does

- **Issue assignment → delegation flow**: Creates a branch, edits code, and opens a PR.
- **Comment mention → mention flow**: Answers read-only questions about the repo.
- **OpenSpec change marker**: Derives the branch name from `<!-- openspec-change: <name> -->` in the issue description and verifies that `openspec/changes/<name>/` exists.

## Architecture

```
Linear ──webhook──▶ Cloudflare Worker ──queue──▶ Cloudflare Queue consumer
                                                        │
                                                        ▼
                                            opencode server on Railway
```

- **Cloudflare Worker**: receives Linear webhooks, verifies signatures, enqueues jobs, and emits early activity.
- **Cloudflare Queue**: owns the lifetime of one job; polls the opencode server every 5s and translates opencode parts into Linear activities.
- **Railway opencode server**: runs the actual coding session with `serverless=false` and `ENABLE_OH_MY_OPENCODE=false`. One Railway service per target repo.

## Prerequisites

- A Cloudflare account with Workers and Queues enabled.
- A Linear OAuth application.
- A Railway account with the [opencode Railway template](https://github.com/opencode-ai/opencode-railway-template) deployed for each repo you want the agent to work on.

## Local development

```bash
pnpm install
pnpm dev          # wrangler dev
pnpm test         # vitest
pnpm run typecheck
```

## Configuration

Copy `wrangler.jsonc.example` to `wrangler.jsonc` (or edit in place) and fill in your IDs:

```jsonc
{
  "name": "linear-opencode-agent",
  "main": "src/index.ts",
  "compatibility_date": "2025-06-22",
  "kv_namespaces": [
    { "binding": "LINEAR_TOKENS", "id": "<your-linear-tokens-kv-id>" },
    { "binding": "SESSION_STATE", "id": "<your-session-state-kv-id>" }
  ],
  "queues": {
    "producers": [
      { "binding": "CODING_TASKS", "queue": "linear-opencode-agent-tasks" }
    ],
    "consumers": [
      {
        "queue": "linear-opencode-agent-tasks",
        "max_batch_size": 1,
        "max_concurrency": 1
      }
    ]
  },
  "vars": {
    "LINEAR_CLIENT_ID": "<your-linear-client-id>",
    "WORKER_URL": "https://linear-opencode-agent.<your-subdomain>.workers.dev",
    "OPENCODE_SERVER_URL": "https://<your-opencode-railway-service>.up.railway.app"
  }
}
```

Set secrets via Wrangler (never commit these):

```bash
wrangler secret put LINEAR_CLIENT_SECRET
wrangler secret put LINEAR_WEBHOOK_SECRET
wrangler secret put OPENCODE_SERVER_PASSWORD
```

### Environment variables and secrets

| Name | Type | Purpose |
|------|------|---------|
| `LINEAR_CLIENT_ID` | var | Linear OAuth app client ID. |
| `LINEAR_CLIENT_SECRET` | secret | Linear OAuth app client secret. |
| `LINEAR_WEBHOOK_SECRET` | secret | Signing secret for verifying Linear webhooks. |
| `WORKER_URL` | var | Public URL of this Worker (used for OAuth redirect). |
| `OPENCODE_SERVER_URL` | var | URL of the Railway opencode server for the target repo. |
| `OPENCODE_SERVER_PASSWORD` | secret | HTTP Basic Auth password for the opencode server. |
| `LINEAR_TOKENS` | KV | Stores OAuth tokens per Linear workspace. |
| `SESSION_STATE` | KV | Session markers and session maps. |
| `CODING_TASKS` | Queue | Work queue for AgentSession jobs. |

## Linear OAuth setup

1. Create an OAuth application in Linear at **Settings → API → OAuth application**.
2. Add the redirect URL: `https://<your-worker-url>/oauth/callback`.
3. Request the `issues`, `comments`, and `write` scopes.
4. Copy the Client ID and Client Secret into the Worker config.
5. Authorize the agent for a workspace by visiting:

   ```
   https://<your-worker-url>/oauth/authorize?workspace_id=<linear-organization-id>
   ```

   The token is stored in `LINEAR_TOKENS` KV and refreshed automatically.

## Linear webhook setup

Create a webhook in Linear that points to:

```
https://<your-worker-url>/webhook
```

Subscribe to **Agent session events**. Linear will send a signing secret; store it as `LINEAR_WEBHOOK_SECRET`.

## Railway opencode server setup

For each repository you want the agent to edit:

1. Deploy the [opencode-railway-template](https://github.com/opencode-ai/opencode-railway-template).
2. Set `serverless=false` in the Railway environment.
3. Set `ENABLE_OH_MY_OPENCODE=false`.
4. Provide `GH_TOKEN` with permissions to clone the repo, push branches, and open PRs.
5. Configure the startup hook to clone the target repo into the service's working directory.
6. Set a strong `OPENCODE_SERVER_PASSWORD` and copy it into the Worker's `OPENCODE_SERVER_PASSWORD` secret.

The Worker is repo-agnostic; it routes each issue to the Railway service configured in `OPENCODE_SERVER_URL`. For multiple repos, deploy multiple Railway services and route via separate Worker instances or a dispatcher.

## Usage

### Delegation flow (code + PR)

1. Create an issue in Linear.
2. Add the OpenSpec change marker to the top of the description:

   ```markdown
   <!-- openspec-change: my-feature -->
   ```

3. Ensure `openspec/changes/my-feature/` exists in the repo.
4. Assign the issue to the agent (the Linear app user).
5. The agent creates branch `feat/my-feature`, implements the change, and opens a PR.

If the OpenSpec directory does not exist, the agent emits an error, removes itself as delegate, and posts a comment explaining the abort.

### Mention flow (read-only answer)

Mention the agent in a comment. The agent runs a read-only opencode session restricted by the tool whitelist in `src/lib/prompts.ts` and replies in a `response` activity.

## Project structure

```
src/
  index.ts              # Worker fetch() and queue() handlers
  types.ts              # Shared TypeScript types
  lib/
    linear.ts           # Linear SDK client and activity helpers
    oauth.ts            # Linear OAuth authorize/callback/refresh
    webhook.ts          # Webhook verification and enqueueing
    queue.ts            # Queue consumer / opencode orchestrator
    opencode.ts         # opencode SDK client wrapper
    prompts.ts          # Delegation and mention prompts
    translator.ts       # opencode Part → Linear AgentActivity mapping
    translator.test.ts  # Translator unit tests
```

## Deploy

```bash
pnpm run deploy
```

After deploying, update `WORKER_URL` if it changed and re-run `wrangler deploy` so the OAuth redirect and webhook URL stay correct.

## License

ISC
