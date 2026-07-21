import type { IOauthService } from '@modules/oauth';
import type { Mocked } from '@suites/unit';

import { LinearClient } from '@linear/sdk';
import { OauthInject } from '@modules/oauth';
import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinearService } from './linear.service';

vi.mock('@linear/sdk', () => ({
	AgentActivityType: { Error: 'error' },
	LinearClient: vi.fn(),
}));

describe('linearService', () => {
	let service: LinearService;
	let oauthService: Mocked<IOauthService>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(LinearService).compile();

		service = unit;
		oauthService = unitRef.get(OauthInject.SERVICE);
	});

	afterEach(() => vi.restoreAllMocks());

	describe('getClient', () => {
		it('should return null when fails to get access token', async () => {
			await oauthService.getAccessToken.mockResolvedValue(null);

			const result = await service.getClient('workspace-1');

			expect(result).toBeNull();
			expect(oauthService.getAccessToken).toHaveBeenCalledWith('workspace-1');
		});

		it('should return a LinearClient when access token is available', async () => {
			await oauthService.getAccessToken.mockResolvedValue('access-token-123');

			const result = await service.getClient('workspace-1');

			expect(result).not.toBeNull();
			expect(oauthService.getAccessToken).toHaveBeenCalledWith('workspace-1');
			expect(vi.mocked(LinearClient)).toHaveBeenCalledWith({ accessToken: 'access-token-123' });
		});
	});

	describe('emitAgentActivity', () => {
		it('should call createAgentActivity with the given params', async () => {
			const mockClient = { createAgentActivity: vi.fn().mockResolvedValue(undefined) };
			const content = { body: 'Something went wrong', type: 'error' as const };

			await service.emitAgentActivity(mockClient as any, 'session-1', content as any);

			expect(mockClient.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: 'session-1',
				content,
			});
		});
	});

	describe('updateSessionExternalUrl', () => {
		it('should call agentSessionUpdateExternalUrl with the PR url', async () => {
			const mockClient = {
				agentSessionUpdateExternalUrl: vi.fn().mockResolvedValue(undefined),
			};

			await service.updateSessionExternalUrl(
				mockClient as any,
				'session-1',
				'https://github.com/owner/repo/pull/42'
			);

			expect(mockClient.agentSessionUpdateExternalUrl).toHaveBeenCalledWith('session-1', {
				externalUrls: [{ label: 'Pull Request', url: 'https://github.com/owner/repo/pull/42' }],
			});
		});
	});

	describe('removeAgentDelegate', () => {
		it('should call updateIssue with delegateId set to null', async () => {
			const mockClient = { updateIssue: vi.fn().mockResolvedValue(undefined) };

			await service.removeAgentDelegate(mockClient as any, 'issue-1');

			expect(mockClient.updateIssue).toHaveBeenCalledWith('issue-1', { delegateId: null });
		});
	});

	describe('postIssueComment', () => {
		it('should call createComment with body and issueId', async () => {
			const mockClient = { createComment: vi.fn().mockResolvedValue(undefined) };

			await service.postIssueComment(mockClient as any, 'issue-1', 'Hello world');

			expect(mockClient.createComment).toHaveBeenCalledWith({
				body: 'Hello world',
				issueId: 'issue-1',
			});
		});
	});

	describe('abortDelegation', () => {
		it('should emit error activity and skip cleanup when issueId is undefined', async () => {
			const mockClient = { createAgentActivity: vi.fn().mockResolvedValue(undefined) };

			await service.abortDelegation(mockClient as any, 'session-1', undefined, 'Error message');

			expect(mockClient.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: 'session-1',
				content: { body: 'Error message', type: 'error' },
			});
		});

		it('should emit error activity and cleanup when issueId is provided', async () => {
			const mockClient = {
				createAgentActivity: vi.fn().mockResolvedValue(undefined),
				createComment: vi.fn().mockResolvedValue(undefined),
				updateIssue: vi.fn().mockResolvedValue(undefined),
			};

			await service.abortDelegation(mockClient as any, 'session-1', 'issue-1', 'Error message');

			expect(mockClient.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: 'session-1',
				content: { body: 'Error message', type: 'error' },
			});
			expect(mockClient.createComment).toHaveBeenCalledWith({
				body: 'Agent could not start: Error message',
				issueId: 'issue-1',
			});
			expect(mockClient.updateIssue).toHaveBeenCalledWith('issue-1', { delegateId: null });
		});

		it('should catch and log cleanup errors gracefully without throwing', async () => {
			const mockClient = {
				createAgentActivity: vi.fn().mockResolvedValue(undefined),
				createComment: vi.fn().mockRejectedValue(new Error('Comment failed')),
				updateIssue: vi.fn().mockResolvedValue(undefined),
			};

			vi.spyOn((service as any).logger, 'error').mockImplementation(() => {});

			await expect(
				service.abortDelegation(mockClient as any, 'session-1', 'issue-1', 'Error message')
			).resolves.toBeUndefined();
		});
	});

	describe('getIssue', () => {
		it('should return the issue from client.issue', async () => {
			const mockIssue = { id: 'issue-1', title: 'Test Issue' };
			const mockClient = { issue: vi.fn().mockResolvedValue(mockIssue) };

			const result = await service.getIssue(mockClient as any, 'issue-1');

			expect(result).toStrictEqual(mockIssue);
			expect(mockClient.issue).toHaveBeenCalledWith('issue-1');
		});

		it('should propagate errors from client.issue', async () => {
			const mockClient = { issue: vi.fn().mockRejectedValue(new Error('Not found')) };

			await expect(service.getIssue(mockClient as any, 'invalid-id')).rejects.toThrow('Not found');
		});
	});
});
