# Split architecture: opencode server on Railway, Worker on Cloudflare

The opencode Go binary cannot run inside a Cloudflare Worker (V8 isolate, no subprocesses), and `createOpencode()` spawns that binary as a child process — so the coding brain must live on a host that can run long-lived processes. We deploy the opencode server to Railway (cwd = the target repo, persistent volume for the clone) and a Cloudflare Worker that uses the SDK in client-only mode (`createOpencodeClient({ baseUrl })`) to drive it. The Vercel AI SDK alternative (Worker owns the agent loop, opencode reduced to a filesystem/shell REST API) was rejected because it rebuilds tool-calling, file editing, LSP, git, and permission logic that opencode already implements.

## Consequences

- One Railway service per target repo. Scaling to multiple repos means more services, not multi-repo juggling inside one server.
- The Worker is a thin translator; all coding intelligence lives in opencode and is configured via `opencode.json` on the Railway repo, not in Worker code.
- `OPENCODE_SERVER_PASSWORD` (HTTP basic auth) is the only thing protecting the opencode server's REST surface — must be rotated and never committed.
