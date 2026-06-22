# Serialize queue consumers (max_concurrency=1)

Cloudflare Queues support high concurrency, but a single opencode server has one working directory and git allows only one branch checked out per working tree. Concurrent queue consumers would clobber each other's branches. We set `max_concurrency: 1` and emit an immediate `thought` activity from the `fetch()` handler (before enqueuing) to satisfy Linear's 10-second first-activity deadline for queued jobs. A second `thought` is emitted when the queued job finally starts.

The rejected alternative — a supervisor process on Railway that spawns a per-worktree `opencode serve` per job — is the documented upgrade path when concurrent sessions matter. It's clean and additive (Worker translation logic unchanged; only the "how do I get an opencode server URL" step changes), but not worth the process-lifecycle/port/cleanup complexity for a personal agent where simultaneous assignments are rare.
