import type { ActivityContent } from '@modules/linear';
import type { Event, Part } from '@opencode-ai/sdk';

import { AgentActivityType } from '@linear/sdk';
import { Injectable } from '@nestjs/common';

import type { IOpencodeEventMapperService } from '../interface';
import type { TranslateContext } from '../opencode-events.type';

@Injectable()
export class OpencodeEventMapperService implements IOpencodeEventMapperService {
	// oxlint-disable-next-line no-magic-numbers
	private readonly MAX_PARAM_LENGTH = 500;

	translatePart(part: Part, context: TranslateContext): ActivityContent | null {
		switch (part.type) {
			case 'text': {
				return context.isFinal
					? { body: part.text, type: AgentActivityType.Response }
					: { body: part.text, type: AgentActivityType.Thought };
			}

			case 'reasoning': {
				return { body: part.text, type: AgentActivityType.Thought };
			}

			case 'tool': {
				const { tool, state } = part;

				switch (state.status) {
					case 'pending':
					case 'running': {
						return {
							action: tool,
							parameter: this.formatParameter(state.input),
							type: AgentActivityType.Action,
						};
					}
					case 'completed': {
						return {
							action: tool,
							parameter: this.formatParameter(state.input),
							result: state.output,
							type: AgentActivityType.Action,
						};
					}
					case 'error': {
						return {
							body: `Tool ${tool} failed: ${state.error}`,
							type: AgentActivityType.Error,
						};
					}
					default: {
						return null;
					}
				}
			}

			case 'patch': {
				return {
					action: 'Edited files',
					parameter: part.files.join(', '),
					type: AgentActivityType.Action,
				};
			}

			case 'retry': {
				return {
					body: `Retrying after error (attempt ${part.attempt}): ${part.error.data.message}`,
					type: AgentActivityType.Thought,
				};
			}

			case 'step-start': {
				return { body: 'Starting next step...', type: AgentActivityType.Thought };
			}

			case 'step-finish': {
				const { input, output, reasoning, cache } = part.tokens;
				const total = input + output + reasoning + cache.read + cache.write;

				return {
					body: `Step finished. Tokens used: ${total}`,
					type: AgentActivityType.Thought,
				};
			}

			case 'file':
			case 'subtask':
			case 'agent':
			case 'snapshot':
			case 'compaction': {
				return null;
			}

			default: {
				return null;
			}
		}
	}

	extractSessionId(event: Event): string | undefined {
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
			case 'command.executed': {
				return event.properties.sessionID;
			}

			// --- `properties.info.id` (Session) ---
			case 'session.created':
			case 'session.updated':
			case 'session.deleted': {
				return event.properties.info.id;
			}

			// --- `properties.info.sessionID` (Message) ---
			case 'message.updated': {
				return event.properties.info.sessionID;
			}

			// --- `properties.part.sessionID` (Part) ---
			case 'message.part.updated': {
				return event.properties.part.sessionID;
			}

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
			case 'pty.deleted': {
				return undefined;
			}

			default: {
				// Exhaustiveness check: if the SDK adds a new event type, this
				// Branch becomes reachable and `event` narrows to `never`.
				// We fall back to `undefined` so the guard lets the event through
				// Rather than silently dropping it.
				return undefined;
			}
		}
	}

	private formatParameter(input: Record<string, unknown> | undefined): string {
		if (!input || Object.keys(input).length === 0) return '';

		try {
			const serialized = JSON.stringify(input);

			if (serialized.length <= this.MAX_PARAM_LENGTH) return serialized;

			return `${serialized.slice(0, this.MAX_PARAM_LENGTH)}...`;
		} catch {
			return '';
		}
	}
}
