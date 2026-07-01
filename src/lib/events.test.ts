import type { Event } from '@opencode-ai/sdk';

import { describe, expect, it } from 'vitest';

import { extractSessionId } from './events';

const event = (type: string, properties: Record<string, unknown> = {}): Event =>
	({ type, properties }) as unknown as Event;

describe('extractSessionId', () => {
	describe('direct properties.sessionID', () => {
		it.each([
			['session.idle'],
			['session.status'],
			['session.compacted'],
			['session.diff'],
			['message.removed'],
			['message.part.removed'],
			['permission.updated'],
			['permission.replied'],
			['todo.updated'],
			['command.executed'],
		])('returns the sessionID for %s', (type) => {
			expect(extractSessionId(event(type, { sessionID: 'sess-1' }))).toBe('sess-1');
		});
	});

	describe('session.error (optional sessionID)', () => {
		it('returns the sessionID when present', () => {
			expect(
				extractSessionId(event('session.error', { sessionID: 'sess-1', error: undefined }))
			).toBe('sess-1');
		});

		it('returns undefined when sessionID is absent', () => {
			expect(extractSessionId(event('session.error', {}))).toBeUndefined();
		});
	});

	describe('properties.info.id (Session)', () => {
		it.each([['session.created'], ['session.updated'], ['session.deleted']])(
			'returns info.id for %s',
			(type) => {
				expect(extractSessionId(event(type, { info: { id: 'sess-1' } }))).toBe('sess-1');
			}
		);
	});

	describe('properties.info.sessionID (Message)', () => {
		it('returns info.sessionID for message.updated', () => {
			expect(extractSessionId(event('message.updated', { info: { sessionID: 'sess-1' } }))).toBe(
				'sess-1'
			);
		});
	});

	describe('properties.part.sessionID (Part)', () => {
		it('returns part.sessionID for message.part.updated', () => {
			expect(
				extractSessionId(
					event('message.part.updated', {
						part: { id: 'p1', sessionID: 'sess-1', messageID: 'm1', type: 'text', text: 'hi' },
					})
				)
			).toBe('sess-1');
		});
	});

	describe('global events (no session id)', () => {
		it.each([
			['server.instance.disposed'],
			['server.connected'],
			['installation.updated'],
			['installation.update-available'],
			['lsp.client.diagnostics'],
			['lsp.updated'],
			['file.edited'],
			['file.watcher.updated'],
			['vcs.branch.updated'],
			['tui.prompt.append'],
			['tui.command.execute'],
			['tui.toast.show'],
			['pty.created'],
			['pty.updated'],
			['pty.exited'],
			['pty.deleted'],
		])('returns undefined for %s', (type) => {
			expect(extractSessionId(event(type))).toBeUndefined();
		});
	});

	describe('unknown event types', () => {
		it('returns undefined for a future event type not in the union', () => {
			const future = { type: 'session.future.event', properties: {} } as unknown as Event;
			expect(extractSessionId(future)).toBeUndefined();
		});
	});
});
