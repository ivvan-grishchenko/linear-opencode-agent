import type { AgentSessionEventWebhookPayload, LinearClient } from '@linear/sdk';

import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../types';

import { buildOpencodeServerUrl, buildRepoMapKey, resolveRepositoryName } from './repo-mapping';

const createMockEnv = (repoMapValue: string | null): Env =>
	({
		OPENCODE_SERVER_URL: 'https://opencode.example.com',
		REPO_MAP: {
			get: vi.fn().mockResolvedValue(repoMapValue),
		},
	}) as unknown as Env;

const createMockLinearClient = (projectId: string | null | undefined): LinearClient =>
	({
		issue: vi.fn().mockResolvedValue({
			projectId: projectId ?? null,
		}),
	}) as unknown as LinearClient;

const createMockLinearClientThatThrows = (): LinearClient =>
	({
		issue: vi.fn().mockRejectedValue(new Error('not found')),
	}) as unknown as LinearClient;

const createPayload = (issueId: string | undefined): AgentSessionEventWebhookPayload =>
	({
		action: 'created',
		organizationId: 'org-1',
		agentSession: {
			id: 'session-1',
			issue: issueId ? ({ id: issueId } as never) : undefined,
		} as never,
	}) as unknown as AgentSessionEventWebhookPayload;

describe('resolveRepositoryName', () => {
	it('returns repositoryName from REPO_MAP keyed by fetched project id', async () => {
		const env = createMockEnv('my-repo');
		const linearClient = createMockLinearClient('project-1');

		const result = await resolveRepositoryName(env, linearClient, createPayload('issue-1'));

		expect(result).toBe('my-repo');
		expect(linearClient.issue).toHaveBeenCalledWith('issue-1');
		expect(env.REPO_MAP.get).toHaveBeenCalledWith('repo:org-1:project-1');
	});

	it('returns null when issue id is missing', async () => {
		const env = createMockEnv('my-repo');
		const linearClient = createMockLinearClient('project-1');

		const result = await resolveRepositoryName(env, linearClient, createPayload(undefined));

		expect(result).toBeNull();
		expect(linearClient.issue).not.toHaveBeenCalled();
		expect(env.REPO_MAP.get).not.toHaveBeenCalled();
	});

	it('returns null when Linear issue fetch fails', async () => {
		const env = createMockEnv('my-repo');
		const linearClient = createMockLinearClientThatThrows();

		const result = await resolveRepositoryName(env, linearClient, createPayload('issue-1'));

		expect(result).toBeNull();
		expect(env.REPO_MAP.get).not.toHaveBeenCalled();
	});

	it('returns null when issue has no project', async () => {
		const env = createMockEnv('my-repo');
		const linearClient = createMockLinearClient(null);

		const result = await resolveRepositoryName(env, linearClient, createPayload('issue-1'));

		expect(result).toBeNull();
		expect(env.REPO_MAP.get).not.toHaveBeenCalled();
	});

	it('returns null when REPO_MAP has no entry', async () => {
		const env = createMockEnv(null);
		const linearClient = createMockLinearClient('project-1');

		const result = await resolveRepositoryName(env, linearClient, createPayload('issue-1'));

		expect(result).toBeNull();
	});
});

describe('buildOpencodeServerUrl', () => {
	it('appends encoded repository name to the base url', () => {
		const env = createMockEnv(null);

		expect(buildOpencodeServerUrl(env, 'my-repo')).toBe('https://opencode.example.com/my-repo/');
	});

	it('normalizes trailing slashes on the base url', () => {
		const env = { OPENCODE_SERVER_URL: 'https://opencode.example.com/' } as unknown as Env;

		expect(buildOpencodeServerUrl(env, 'my-repo')).toBe('https://opencode.example.com/my-repo/');
	});

	it('url-encodes the repository name', () => {
		const env = createMockEnv(null);

		expect(buildOpencodeServerUrl(env, 'my repo')).toBe('https://opencode.example.com/my%20repo/');
	});
});

describe('buildRepoMapKey', () => {
	it('returns the expected key format', () => {
		expect(buildRepoMapKey('org-1', 'project-1')).toBe('repo:org-1:project-1');
	});
});
