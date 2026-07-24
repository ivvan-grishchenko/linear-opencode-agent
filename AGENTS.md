# AGENTS.md

Guidance for AI coding agents (opencode, Claude Code, etc.) working in this repository.

## Project

**`linear-opencode-agent`** — a NestJS service that connects Linear webhooks to a running [opencode](https://opencode.ai) server. When an issue is assigned to the agent, it spins up an opencode session to work the issue; it can also respond to comments. SQLite (via Drizzle ORM) is used for persistence.

- **Runtime:** Node.js >= 24.14.0, pnpm ^11.1.2
- **Framework:** NestJS 11 (Express adapter)
- **ORM:** Drizzle ORM + drizzle-kit, SQLite
- **External SDKs:** `@linear/sdk`, `@opencode-ai/sdk`, `axios`
- **Validation:** `zod` (used at module boundaries)
- **Tests:** `vitest` (unit + e2e), `@suites/unit` + `@suites/di.nestjs` for DI mocking
- **Lint/format:** `oxlint` + `oxfmt`

## Repository layout

```
src/
  main.ts                  # bootstrap; reads APP_PORT, validates config, runs migrations
  app.module.ts            # root module — wires all feature modules
  config/                  # zod-validated typed config (env files via @nestjs/config)
  db/                      # Drizzle schema + client + migration helper
  modules/
    agent-session/         # opencode session lifecycle, events, repo, service
    database/              # DB health / connection provider
    health/                # /health endpoint (terminus)
    linear/                # Linear SDK wrapper
    oauth/                 # Linear OAuth flow
    opencode/              # opencode SDK wrapper
    opencode-events/       # SSE/event stream consumer
    webhook/               # Linear webhook controller (signature verification)
drizzle/                   # generated SQL migrations + meta/
test/                      # unit tests (mirrors src/)
drizzle.config.ts
nest-cli.json
Dockerfile                 # multi-stage; targets: deps, build, runtime
```

Each feature module follows the same internal shape:

```
modules/<name>/
  events/      # @nestjs/event-emitter payloads
  interface/   # DTOs and contracts
  repository/  # DB / external-system access
  service/     # business logic; controllers live in <name>.module.ts / <name>.controller.ts
```

## Environment variables

All config is loaded by `@nestjs/config` and validated with `zod` in `src/config/`. See `.env.example` for the canonical list.

| Variable | Purpose |
|---|---|
| `LINEAR_CLIENT_ID` | Linear OAuth app client ID |
| `LINEAR_CLIENT_SECRET` | Linear OAuth app client secret |
| `LINEAR_WEBHOOK_SECRET` | Signing secret for webhook payloads |
| `APP_URL` | Public base URL (used for OAuth callbacks) |
| `APP_PORT` | HTTP port (default `4000`) |
| `DB_FILE_NAME` | SQLite DSN, e.g. `file:/data/app.db` (Docker) or `local.db` (dev) |
| `OPENCODE_SERVER_URL` | URL of the opencode server |
| `OPENCODE_SERVER_PASSWORD` | opencode server auth password |

## Common commands

```bash
pnpm install                # one-time setup
pnpm run start:dev          # nest start --watch
pnpm build                  # nest build → dist/
pnpm start:prod             # node dist/main

pnpm test                   # vitest run (unit)
pnpm test:e2e               # vitest run --config ./vitest.config.e2e.ts
pnpm test:cov               # coverage report

pnpm lint                   # oxlint
pnpm lint:fix               # oxlint --fix
pnpm fmt                    # oxfmt
pnpm fmt:check              # oxfmt --check

pnpm db:generate            # generate migration from schema
pnpm db:migrate             # apply migrations
pnpm db:push                # push schema (dev only, no migration file)
```

## Docker

```bash
docker build -t linear-opencode-agent:latest .
docker run -d -p 4000:4000 -v sqlite-data:/data -e DB_FILE_NAME=file:/data/app.db ... linear-opencode-agent:latest
```

Migrations are applied automatically when the app starts. The image has named stages: `deps`, `build`, `runtime`. The `sqlite-data` volume is mounted at `/data`.

## Code conventions

- **TypeScript:** strict mode (see `tsconfig.json`). Prefer `type` over `interface` for plain shapes; use `interface` only for extension contracts.
- **Modules:** ESM (`"type": "module"`). Use `.js` extensions in import specifiers even for `.ts` source.
- **Naming:** files `kebab-case.ts`; classes `PascalCase`; functions/vars `camelCase`; constants `UPPER_SNAKE`.
- **Validation:** validate external input (HTTP, env, SDK responses) with `zod` at the boundary; trust internal types.
- **Errors:** throw `HttpException` subclasses in controllers; throw domain errors in services. Map to HTTP status in controllers, not services.
- **Side effects:** keep I/O (DB, HTTP, opencode SDK) in `repository/` or `service/` — never in `events/` or `interface/`.
- **DI:** use Nest's constructor injection. When testing, use `@suites/unit` (`@TestBed()`) and `@suites/doubles.vitest` for mocks.
- **Comments:** only when they explain *why*, not *what*. No banner comments, no JSDoc on self-explanatory methods.
- **Formatting:** `oxfmt` defaults; 2-space indent; single quotes; trailing commas in multi-line.
- **Linting:** `oxlint` — fix with `pnpm lint:fix`. Don't disable rules; refactor instead.

## Testing guidelines

- Unit tests live next to the module under `test/`, mirroring `src/modules/<name>/`.
- Use `describe` / `it` (not `test`).
- Mock external SDKs (Linear, opencode) at the boundary; never hit the network in unit tests.
- E2E tests use `supertest` against a bootstrapped Nest app and require a real or stubbed opencode server — keep them in `test/e2e/` and configure with `vitest.config.e2e.ts`.
- Aim for tests on `service/` classes; `controller` / `repository` tests are optional but welcome.

## Database / migrations

- Schema lives in `src/db/schema.ts`. After changes:
  ```bash
  pnpm db:generate   # creates a SQL file in drizzle/
  git add drizzle/
  ```
- Never edit generated SQL in `drizzle/*.sql` by hand.
- In Docker, migrations are applied automatically on application startup using `drizzle-orm/libsql/migrator`.
- The app container must mount the `DB_FILE_NAME` path (default `file:/data/app.db` in Docker).

## Commit & PR conventions

- Commit messages: short imperative summary, optional body explaining *why*.
- Keep commits scoped; one logical change per commit.
- Run `pnpm lint && pnpm fmt:check && pnpm test` before pushing.
- PR description should link the Linear issue (if any) and call out schema/breaking changes explicitly.

## What NOT to do

- Don't introduce new top-level dependencies without justification — the dep list is curated.
- Don't add JSDoc / banner comments to obvious code.
- Don't run `pnpm db:push` against the production SQLite volume.
- Don't add new global singletons — use Nest DI.
- Don't change the Node engine or pnpm version in `package.json` without coordinating with the Docker / CI pipeline (Node version is pinned in `Dockerfile` and `package.json` `engines`).
- Don't commit `.env`, `local.db`, `dist/`, or `coverage/` — all are gitignored.

## Pointers for common tasks

- **Add a new webhook handler** → `src/modules/webhook/` (controller) + new event payload in `src/modules/webhook/events/`.
- **Add a new opencode event handler** → `src/modules/opencode-events/`.
- **Add a new env var** → add to `src/config/`, `.env.example`, and this table.
- **Add a new domain entity** → schema in `src/db/schema.ts`, then `pnpm db:generate`.
- **Add a new HTTP route** → controller in the relevant feature module; validate input with `zod`; return DTOs from `interface/`.

# Agent Instructions

## Tool Usage Guidelines
- Whenever you need to read, write, edit, search, or refactor files, you must use the `serena` MCP server tools.
- Rely on Serena's semantic code retrieval and high-level symbol abstractions instead of raw file system commands or low-level line edits.
