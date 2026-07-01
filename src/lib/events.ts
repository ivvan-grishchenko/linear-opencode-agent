import type { Event } from '@opencode-ai/sdk';

/**
 * Extract the opencode session ID an event pertains to.
 *
 * The opencode event stream is global (no server-side sessionID filter), so the
 * queue consumer must verify every event belongs to the opencode session it is
 * driving. The `Event` union carries the session ID in three different shapes:
 *
 *  - `properties.sessionID` for most session/message/permission/command events
 *    (optional on `session.error`)
 *  - `properties.info.id` (a `Session`) for `session.created|updated|deleted`
 *  - nested on a sub-object: `properties.info.sessionID` (a `Message`) for
 *    `message.updated`, and `properties.part.sessionID` (a `Part`) for
 *    `message.part.updated`
 *
 * Global events (installation, lsp, file, vcs, tui, pty, server) carry no
 * session ID and return `undefined`. The guard in `pollAndTranslate` treats
 * `undefined` as "no verdict" and lets the event reach the `switch`.
 */
export function extractSessionId(event: Event): string | undefined {
	switch (event.type) {
		// --- Direct `properties.sessionID` ---
		case 'session.idle':
		case 'session.status':
		case 'session.compacted':
		case 'session.diff':
		case 'session.error':
		case 'message.removed':
		case 'message.part.removed':
		case 'permission.updated':
		case 'permission.replied':
		case 'todo.updated':
		case 'command.executed':
			return event.properties.sessionID;

		// --- `properties.info.id` (Session) ---
		case 'session.created':
		case 'session.updated':
		case 'session.deleted':
			return event.properties.info.id;

		// --- `properties.info.sessionID` (Message) ---
		case 'message.updated':
			return event.properties.info.sessionID;

		// --- `properties.part.sessionID` (Part) ---
		case 'message.part.updated':
			return event.properties.part.sessionID;

		// --- Global events (no session ID) ---
		case 'server.instance.disposed':
		case 'server.connected':
		case 'installation.updated':
		case 'installation.update-available':
		case 'lsp.client.diagnostics':
		case 'lsp.updated':
		case 'file.edited':
		case 'file.watcher.updated':
		case 'vcs.branch.updated':
		case 'tui.prompt.append':
		case 'tui.command.execute':
		case 'tui.toast.show':
		case 'pty.created':
		case 'pty.updated':
		case 'pty.exited':
		case 'pty.deleted':
			return undefined;

		default:
			// Exhaustiveness check: if the SDK adds a new event type, this
			// branch becomes reachable and `event` narrows to `never`.
			// We fall back to `undefined` so the guard lets the event through
			// rather than silently dropping it.
			return undefined;
	}
}
