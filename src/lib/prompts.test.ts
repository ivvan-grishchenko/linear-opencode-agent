import type { AgentSessionEventWebhookPayload } from '@linear/sdk';

import { describe, expect, it } from 'vitest';

import { buildDelegationPrompt, buildMentionPrompt, MENTION_READ_ONLY_TOOLS } from './prompts';

function createDelegationWebhook(
	overrides: Partial<AgentSessionEventWebhookPayload> = {}
): AgentSessionEventWebhookPayload {
	return {
		action: 'created',
		agentSession: { id: 'session-1' },
		organizationId: 'org-1',
		promptContext: 'Some context',
		...overrides,
	} as AgentSessionEventWebhookPayload;
}

describe('buildDelegationPrompt', () => {
	it('includes issue identifier and title', () => {
		const webhook = createDelegationWebhook({
			agentSession: {
				id: 'session-1',
				issue: { identifier: 'ENG-42', title: 'Add feature', id: 'issue-1' } as never,
			} as never,
		});
		const prompt = buildDelegationPrompt(webhook, {
			name: 'my-change',
			branchName: 'feat/my-change',
			directoryPath: 'openspec/changes/my-change',
		});
		expect(prompt).toContain('Identifier: ENG-42');
		expect(prompt).toContain('Title: Add feature');
	});

	it('falls back to defaults when issue data is missing', () => {
		const webhook = createDelegationWebhook();
		const prompt = buildDelegationPrompt(webhook, {
			name: 'my-change',
			branchName: 'feat/my-change',
			directoryPath: 'openspec/changes/my-change',
		});
		expect(prompt).toContain('Identifier: UNKNOWN');
		expect(prompt).toContain('Title: Untitled issue');
	});

	it('includes prompt context and OpenSpec change instructions', () => {
		const webhook = createDelegationWebhook({ promptContext: 'Implement the thing.' });
		const prompt = buildDelegationPrompt(webhook, {
			name: 'my-change',
			branchName: 'feat/my-change',
			directoryPath: 'openspec/changes/my-change',
		});
		expect(prompt).toContain('Implement the thing.');
		expect(prompt).toContain('source of truth');
		expect(prompt).toContain('git checkout -b feat/my-change');
	});
});

describe('buildMentionPrompt', () => {
	it('includes prompt context and comment body', () => {
		const webhook = createDelegationWebhook({
			agentSession: {
				id: 'session-1',
				comment: { body: 'What does this do?', id: 'comment-1' } as never,
			} as never,
		});
		const prompt = buildMentionPrompt(webhook);
		expect(prompt).toContain('Some context');
		expect(prompt).toContain('What does this do?');
		expect(prompt).toContain('read-only consultation');
	});

	it('handles missing comment body', () => {
		const webhook = createDelegationWebhook();
		const prompt = buildMentionPrompt(webhook);
		expect(prompt).toContain("## The user's question");
	});
});

describe('MENTION_READ_ONLY_TOOLS', () => {
	it('allows read-only tools', () => {
		expect(MENTION_READ_ONLY_TOOLS.read).toBe(true);
		expect(MENTION_READ_ONLY_TOOLS.grep).toBe(true);
		expect(MENTION_READ_ONLY_TOOLS.glob).toBe(true);
	});

	it('denies mutable tools', () => {
		expect(MENTION_READ_ONLY_TOOLS.edit).toBe(false);
		expect(MENTION_READ_ONLY_TOOLS.write).toBe(false);
		expect(MENTION_READ_ONLY_TOOLS.bash).toBe(false);
		expect(MENTION_READ_ONLY_TOOLS.apply_patch).toBe(false);
	});
});
