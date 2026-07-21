// oxlint-disable typescript/no-misused-spread
import type { AgentSessionEventWebhookPayload } from '@linear/sdk';

import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenSpecChange } from '../agent-session.type';

import { AgentSessionPromptService } from './agent-session.prompt.service';

const mockChange: OpenSpecChange = {
	branchName: 'feat/my-feature',
	directoryPath: 'openspec/changes/my-feature',
	name: 'my-feature',
};

function buildWebhook(
	overrides?: Partial<AgentSessionEventWebhookPayload>
): AgentSessionEventWebhookPayload {
	return {
		action: 'created',
		agentSession: {
			appUserId: 'app-user-1',
			comment: null,
			commentId: null,
			createdAt: '2024-01-01T00:00:00Z',
			creator: null,
			creatorId: null,
			endedAt: null,
			id: 'session-1',
			issue: {
				description: 'Some description',
				id: 'issue-1',
				identifier: 'LIN-123',
				team: { id: 'team-1' },
				teamId: 'team-1',
				title: 'Test issue',
				url: 'https://linear.app/issue/LIN-123',
			},
			organizationId: 'org-1',
			sourceCommentId: null,
			sourceMetadata: null,
			startedAt: null,
			status: 'active',
			summary: null,
			type: 'delegation',
			updatedAt: '2024-01-01T00:00:00Z',
		},
		appUserId: 'app-user-1',
		createdAt: '2024-01-01T00:00:00Z',
		guidance: [],
		oauthClientId: 'oauth-1',
		organizationId: 'org-1',
		previousComments: [],
		promptContext: '## Issue context\nSome context about the issue.',
		type: 'AgentSession',
		webhookId: 'webhook-1',
		webhookTimestamp: 1_704_067_200_000,
		...overrides,
	} as AgentSessionEventWebhookPayload;
}

describe('agentSessionPromptService', () => {
	let service: AgentSessionPromptService;

	beforeEach(async () => {
		const { unit } = await TestBed.solitary(AgentSessionPromptService).compile();
		service = unit;
	});

	afterEach(() => vi.resetAllMocks());

	describe('buildDelegationPrompt', () => {
		it('should return prompt with all fields populated', () => {
			const webhook = buildWebhook();
			const result = service.buildDelegationPrompt(webhook, mockChange);

			expect(result).toContain('LIN-123');
			expect(result).toContain('Test issue');
			expect(result).toContain('Some context about the issue.');
			expect(result).toContain('`feat/my-feature`');
			expect(result).toContain('my-feature');
			expect(result).toContain('git checkout -b feat/my-feature');
			expect(result).toContain('gh pr create --title "feat: my-feature"');
			expect(result).toContain('Implements my-feature. Closes LIN-123.');
			expect(result).toContain('You are a coding agent');
		});

		it('should fallback identifier to UNKNOWN when issue is undefined', () => {
			const webhook = buildWebhook({
				agentSession: { ...buildWebhook().agentSession, issue: undefined },
			});
			const result = service.buildDelegationPrompt(webhook, mockChange);

			expect(result).toContain('UNKNOWN');
		});

		it('should fallback title to "Untitled issue" when issue is undefined', () => {
			const webhook = buildWebhook({
				agentSession: { ...buildWebhook().agentSession, issue: undefined },
			});
			const result = service.buildDelegationPrompt(webhook, mockChange);

			expect(result).toContain('Untitled issue');
		});

		it('should use empty identifier when issue.identifier is empty string (?? only falls back on null/undefined)', () => {
			const webhook = buildWebhook({
				agentSession: {
					...buildWebhook().agentSession,
					issue: { ...buildWebhook().agentSession.issue!, identifier: '' },
				},
			});
			const result = service.buildDelegationPrompt(webhook, mockChange);

			expect(result).toMatch(/Identifier: \n/);
		});

		it('should fallback promptContext to empty string when undefined', () => {
			const webhook = buildWebhook({ promptContext: undefined });
			const result = service.buildDelegationPrompt(webhook, mockChange);

			expect(result).not.toContain('undefined');
			expect(result).toMatch(/## OpenSpec change/);
		});

		it('should handle promptContext being null', () => {
			const webhook = buildWebhook({ promptContext: null as unknown as string });
			const result = service.buildDelegationPrompt(webhook, mockChange);

			expect(result).not.toContain('null');
		});

		it('should include the git workflow instructions with correct branch name', () => {
			const webhook = buildWebhook();
			const result = service.buildDelegationPrompt(webhook, mockChange);

			expect(result).toContain('git checkout -b feat/my-feature');
			expect(result).toContain('Always work on `feat/my-feature`');
		});

		it('should include the PR creation command with correct title and body', () => {
			const webhook = buildWebhook();
			const result = service.buildDelegationPrompt(webhook, mockChange);

			expect(result).toContain(
				'gh pr create --title "feat: my-feature" --body "Implements my-feature. Closes LIN-123."'
			);
		});

		it('should include issue identifier in commit message reference and PR body', () => {
			const webhook = buildWebhook();
			const result = service.buildDelegationPrompt(webhook, mockChange);

			expect(result).toContain('LIN-123');
			expect(result).toMatch(/Closes LIN-123/);
		});
	});

	describe('buildMentionPrompt', () => {
		it('should return prompt with all fields populated', () => {
			const webhook = buildWebhook({
				agentSession: {
					...buildWebhook().agentSession,
					comment: {
						body: 'Can you help me understand this code?',
						id: 'comment-1',
						issueId: 'issue-1',
					},
				},
			});
			const result = service.buildMentionPrompt(webhook);

			expect(result).toContain('Some context about the issue.');
			expect(result).toContain('Can you help me understand this code?');
			expect(result).toContain('read-only consultation');
			expect(result).toContain('Do not edit files');
			expect(result).toContain('You are a code-aware assistant');
		});

		it('should fallback promptContext to empty when undefined', () => {
			const webhook = buildWebhook({
				agentSession: {
					...buildWebhook().agentSession,
					comment: { body: 'What does this do?', id: 'comment-1', issueId: 'issue-1' },
				},
				promptContext: undefined,
			});
			const result = service.buildMentionPrompt(webhook);

			expect(result).not.toContain('undefined');
			expect(result).toContain('What does this do?');
		});

		it('should fallback promptContext to empty when null', () => {
			const webhook = buildWebhook({
				agentSession: {
					...buildWebhook().agentSession,
					comment: { body: 'How does this work?', id: 'comment-1', issueId: 'issue-1' },
				},
				promptContext: null as unknown as string,
			});
			const result = service.buildMentionPrompt(webhook);

			expect(result).not.toContain('null');
		});

		it('should use empty string for comment body when comment is null', () => {
			const webhook = buildWebhook({
				agentSession: { ...buildWebhook().agentSession, comment: null },
			});
			const result = service.buildMentionPrompt(webhook);

			expect(result).toContain("## The user's question");
			expect(result).toMatch(/## The user's question\n\n/);
		});

		it('should use empty string for comment body when comment body is empty', () => {
			const webhook = buildWebhook({
				agentSession: {
					...buildWebhook().agentSession,
					comment: { body: '', id: 'comment-1', issueId: 'issue-1' },
				},
			});
			const result = service.buildMentionPrompt(webhook);

			expect(result).toContain("## The user's question");
		});

		it('should include read-only instructions', () => {
			const webhook = buildWebhook({
				agentSession: {
					...buildWebhook().agentSession,
					comment: { body: 'How do I fix this?', id: 'comment-1', issueId: 'issue-1' },
				},
			});
			const result = service.buildMentionPrompt(webhook);

			expect(result).toContain('Do not edit files');
			expect(result).toContain('read-only consultation');
		});

		it('should include code-aware assistant opening line', () => {
			const webhook = buildWebhook({
				agentSession: {
					...buildWebhook().agentSession,
					comment: { body: 'Explain this code', id: 'comment-1', issueId: 'issue-1' },
				},
			});
			const result = service.buildMentionPrompt(webhook);

			expect(result).toContain('You are a code-aware assistant');
		});
	});
});
