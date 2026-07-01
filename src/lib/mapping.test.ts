import type { AgentSessionEventWebhookPayload, LinearClient } from '@linear/sdk';

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { Env } from '../types';

import { Mapping } from './mapping';

interface MockEnv {
	env: Env;
	get: Mock<(key: string) => Promise<string | null>>;
}

const createMockEnv = (): MockEnv => {
	const get = vi.fn<(key: string) => Promise<string | null>>();
	const env = { REPO_MAP: { get } as unknown as KVNamespace } as Env;

	return { env, get };
};

describe('Mapping', () => {
	describe('resolveRepositoryName', () => {
		let mockEnv: MockEnv;

		beforeEach(() => {
			mockEnv = createMockEnv();
		});

		it('should return null when there is no organizationId', async () => {
			const response = await Mapping.resolveRepositoryName(
				mockEnv.env,
				{} as LinearClient,
				{ agentSession: { issueId: 'issue-1' } } as AgentSessionEventWebhookPayload
			);

			expect(response).toBeNull();
		});

		it('should return null when there is no issueId', async () => {
			const response = await Mapping.resolveRepositoryName(
				mockEnv.env,
				{} as LinearClient,
				{ organizationId: 'org-1', agentSession: {} } as AgentSessionEventWebhookPayload
			);

			expect(response).toBeNull();
		});

		it('should throw an error when linear client fails to fetch issue', async () => {
			const linearClient = {
				issue: vi.fn().mockRejectedValue(new Error('Network error')),
			} as unknown as LinearClient;

			await expect(
				Mapping.resolveRepositoryName(mockEnv.env, linearClient, {
					organizationId: 'org-1',
					agentSession: { issueId: 'issue-1' },
				} as AgentSessionEventWebhookPayload)
			).rejects.toThrow('Network error');
		});

		it('should return null when linear client returns issue without a project id', async () => {
			const linearClient = {
				issue: vi.fn().mockResolvedValue({ projectId: null }),
			} as unknown as LinearClient;

			const response = await Mapping.resolveRepositoryName(mockEnv.env, linearClient, {
				organizationId: 'org-1',
				agentSession: { issueId: 'issue-1' },
			} as AgentSessionEventWebhookPayload);

			expect(response).toBeNull();
			expect(mockEnv.get).not.toHaveBeenCalled();
		});

		it('should return null when there is no value in repo map', async () => {
			mockEnv.get.mockResolvedValue(null);
			const linearClient = {
				issue: vi.fn().mockResolvedValue({ projectId: 'project-1' }),
			} as unknown as LinearClient;

			const response = await Mapping.resolveRepositoryName(mockEnv.env, linearClient, {
				organizationId: 'org-1',
				agentSession: { issueId: 'issue-1' },
			} as AgentSessionEventWebhookPayload);

			expect(response).toBeNull();
			expect(mockEnv.get).toHaveBeenCalledWith('repo:org-1:project-1');
		});

		it('should return repository name', async () => {
			mockEnv.get.mockResolvedValue('my-org/my-repo');
			const linearClient = {
				issue: vi.fn().mockResolvedValue({ projectId: 'project-1' }),
			} as unknown as LinearClient;

			const response = await Mapping.resolveRepositoryName(mockEnv.env, linearClient, {
				organizationId: 'org-1',
				agentSession: { issueId: 'issue-1' },
			} as AgentSessionEventWebhookPayload);

			expect(response).toEqual({
				repositoryName: 'my-org/my-repo',
				issue: { projectId: 'project-1' },
			});
			expect(mockEnv.get).toHaveBeenCalledWith('repo:org-1:project-1');
		});
	});
});
