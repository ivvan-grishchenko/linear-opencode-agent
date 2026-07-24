# linear-opencode-agent

A Linear AI agent that automatically codes on assigned issues and assists in comments via [opencode](https://opencode.ai).

Built with NestJS, Drizzle ORM (SQLite), and the Linear & opencode SDKs.

## Prerequisites

- **Node.js** >= 24.14.0
- **pnpm** ^11.1.2
- A Linear OAuth application (client ID, client secret, webhook secret)
- A running [opencode server](https://opencode.ai)

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
|---|---|
| `LINEAR_CLIENT_ID` | Linear OAuth app client ID |
| `LINEAR_CLIENT_SECRET` | Linear OAuth app client secret |
| `LINEAR_WEBHOOK_SECRET` | Linear webhook signing secret |
| `APP_URL` | Public URL of the app (used for webhook callbacks) |
| `APP_PORT` | Port the server listens on (default: `4000`) |
| `DB_FILE_NAME` | SQLite database path (e.g. `file:/data/app.db` or `local.db`) |
| `OPENCODE_SERVER_URL` | URL of the opencode server |
| `OPENCODE_SERVER_PASSWORD` | opencode server auth password |

## Local Development

```bash
# Install dependencies
pnpm install

# Apply DB migrations (development)
pnpm db:push

# Start in watch mode
pnpm run start:dev
```

The server starts on `http://localhost:4000` by default.

## Docker

### Build the image

```bash
docker build -t linear-opencode-agent:latest .
```

### Run the container

```bash
docker run -d \
  -p 4000:4000 \
  -v sqlite-data:/data \
  -e DB_FILE_NAME=file:/data/app.db \
  -e LINEAR_CLIENT_ID=<your-client-id> \
  -e LINEAR_CLIENT_SECRET=<your-client-secret> \
  -e LINEAR_WEBHOOK_SECRET=<your-webhook-secret> \
  -e APP_URL=<your-public-url> \
  -e OPENCODE_SERVER_URL=<your-opencode-server> \
  -e OPENCODE_SERVER_PASSWORD=<your-opencode-password> \
  linear-opencode-agent:latest
```

Drizzle migrations are applied automatically when the application starts, so no separate migration step is required.

The SQLite database is persisted in the `sqlite-data` named volume.

## Database

Migrations are managed with [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview).

```bash
pnpm db:generate   # Generate migration files from schema changes
pnpm db:migrate    # Apply migrations manually (local development)
pnpm db:push       # Push schema changes directly (dev only)
```

In production and inside the Docker image, pending migrations are applied automatically on startup using [`drizzle-orm/libsql/migrator`](https://orm.drizzle.team/docs/migrations). The migration files in `./drizzle` are bundled into the image and executed at runtime.

## Testing

```bash
pnpm test          # Unit tests
pnpm test:e2e      # E2E tests
pnpm test:cov      # Coverage report
```

## Linting & Formatting

```bash
pnpm lint          # Lint with oxlint
pnpm lint:fix      # Auto-fix lint issues
pnpm fmt           # Format with oxfmt
pnpm fmt:check     # Check formatting
```

## License

ISC
