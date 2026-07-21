import type { AgentSessionEventWebhookPayload, Issue, LinearClient } from '@linear/sdk';
import type { ILinearService } from '@modules/linear';
import type { Mocked } from '@suites/unit';

import { LinearInject } from '@modules/linear';
import { BadRequestException } from '@nestjs/common';
import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAgentSessionEventProcessor, IAgentSessionRepository } from '../interface';

import { AgentSessionInject } from '../agent-session.enum';
import { AgentSessionValidatorService } from './agent-session.validator.service';

describe('agentSessionValidatorService', () => {
	let service: AgentSessionValidatorService;
	let processor: Mocked<IAgentSessionEventProcessor>;
	let repository: Mocked<IAgentSessionRepository>;
	let linearService: Mocked<ILinearService>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(AgentSessionValidatorService).compile();

		service = unit;
		processor = unitRef.get(AgentSessionInject.PROCESSOR);
		repository = unitRef.get(AgentSessionInject.REPOSITORY);
		linearService = unitRef.get(LinearInject.SERVICE);
	});

	afterEach(() => vi.resetAllMocks());

	describe('parseOpenSpecChange', () => {
		it('should return ok false response when marker is missing', () => {
			const description = 'some description';

			const response = service.parseOpenSpecChange(description);

			expect(response).toStrictEqual({
				message: 'No `<!-- openspec-change: <name> -->` marker found in the issue description.',
				ok: false,
				reason: 'missing-marker',
			});
		});

		it('should return found match when description contains marker', () => {
			const description = 'description <!-- openspec-change: name -->';

			const response = service.parseOpenSpecChange(description);

			expect(response).toStrictEqual({
				change: { branchName: 'feat/name', directoryPath: 'openspec/changes/name', name: 'name' },
				ok: true,
			});
		});
	});

	describe('validateEvent', () => {
		it('should throw bad request exception when fails to create linear client', async () => {
			const payload = {
				agentSession: { id: 'agent-session-1', issueId: 'issue-1' },
				organizationId: 'org-1',
			} as AgentSessionEventWebhookPayload;

			await linearService.getClient.mockResolvedValue(null);
			await repository.updateStatus.mockResolvedValue();

			await expect(service.validateEvent(payload)).rejects.toThrow(BadRequestException);
			expect(linearService.getClient).toHaveBeenCalledWith('org-1');
			expect(repository.updateStatus).toHaveBeenCalledWith(
				'agent-session-1',
				'failed',
				'Linear OAuth token not found'
			);
		});

		describe('succeeds to retrieve linear client', () => {
			const client = {} as LinearClient;

			beforeEach(async () => {
				await linearService.getClient.mockResolvedValue(client);
			});

			it('should throw bad request exception when issue id is missing', async () => {
				const payload = {
					agentSession: { id: 'agent-session-1' },
					organizationId: 'org-1',
				} as AgentSessionEventWebhookPayload;

				await processor.abort.mockResolvedValue();

				await expect(service.validateEvent(payload)).rejects.toThrow(BadRequestException);
				expect(processor.abort).toHaveBeenCalledWith(
					client,
					'agent-session-1',
					undefined,
					'No issue associated with this agent session.'
				);
			});

			describe('issue id is present', () => {
				const payload = {
					agentSession: { id: 'agent-session-1', issueId: 'issue-1' },
					organizationId: 'org-1',
				} as AgentSessionEventWebhookPayload;
				const issue = { projectId: 'proj-1', title: 'title' } as Issue;

				beforeEach(async () => {
					await linearService.getIssue.mockResolvedValue(issue);
				});

				it('should throw bad request exception when fails to resolve repository name', async () => {
					await repository.resolveRepositoryName.mockResolvedValue(null);

					await expect(service.validateEvent(payload)).rejects.toThrow(BadRequestException);
					expect(repository.resolveRepositoryName).toHaveBeenCalledWith('org-1', 'proj-1');
					expect(processor.abort).toHaveBeenCalledWith(
						client,
						'agent-session-1',
						'issue-1',
						'This Linear project is not mapped to an opencode repository. Add a mapping and try again.'
					);
				});

				it('should return response when resolves repository name', async () => {
					await repository.resolveRepositoryName.mockResolvedValue('repo');

					const response = await service.validateEvent(payload);

					expect(response).toStrictEqual({
						client,
						issue,
						issueId: 'issue-1',
						issueTitle: 'title',
						repositoryName: 'repo',
					});
				});
			});
		});
	});
});
