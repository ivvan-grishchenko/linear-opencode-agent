# Use opencode-railway-template with serverless disabled

We deploy the opencode server using [LaceLetho/opencode-railway-template](https://github.com/LaceLetho/opencode-railway-template) rather than hand-rolling a Dockerfile. The template gives us HTTP Basic Auth proxying, persistent volume wiring (`/data`), opencode version pinning via `OPENCODE_REF`, graceful shutdown, and process supervision — all of which we'd otherwise build ourselves. The browser/cookie/mobile-UI features are inert for our use case (the Worker uses Basic Auth and ignores them).

Three required overrides from template defaults:

1. **`serverless = false`** in `railway.toml`. The template enables Railway serverless sleep by default, but cold start on a from-source opencode build is 30s–2min — that blows Linear's 10-second first-activity deadline for delegation sessions and stalls every `prompted` follow-up after idle. For a personal agent, the cost saving isn't worth the UX hit.
2. **`ENABLE_OH_MY_OPENCODE = false`**. The template auto-injects `oh-my-openagent@latest`, an opinionated plugin bundling extra skills/agents. We want a controlled `opencode.json` defining exactly the tools and behavior for the OpenSpec workflow, not a grab-bag.
3. **Startup hook in `start.sh`** to `git clone`/`git pull` the target repo into `/data/workspace` before `exec node server.js`. The template sets the workspace path but doesn't populate it. `GH_TOKEN` is a Railway env var so `gh pr create` works under the opencode session.

The rejected alternative — hand-rolling a Dockerfile — gives more control but means maintaining Basic Auth, version pinning, volume wiring, and signal handling ourselves with no real benefit for a single-server personal agent.
