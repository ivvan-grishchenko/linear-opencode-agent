import type { ConfigType } from '@nestjs/config';

import { OpencodeConfig } from '@config/opencode.config';
import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpencodeService } from './opencode.service';

const mockAgent = {
	createSession: vi.fn(),
	getEventsStream: vi.fn(),
	getMessages: vi.fn(),
	getSession: vi.fn(),
	isSessionFinished: vi.fn(),
	promptAsync: vi.fn(),
};

vi.mock('./opencode-agent', () => {
	class MockOpenCodeAgent {
		createSession = mockAgent.createSession;
		promptAsync = mockAgent.promptAsync;
		getEventsStream = mockAgent.getEventsStream;
		getMessages = mockAgent.getMessages;
		isSessionFinished = mockAgent.isSessionFinished;
		getSession = mockAgent.getSession;
	}

	return { OpenCodeAgent: MockOpenCodeAgent };
});

describe('opencodeService', () => {
	let service: OpencodeService;
	let config: ConfigType<typeof OpencodeConfig>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(OpencodeService).compile();

		service = unit;
		config = unitRef.get(OpencodeConfig.KEY);
		config.serverUrl = 'http://localhost:3000';
		config.serverPassword = 'password123';
	});

	afterEach(() => vi.clearAllMocks());

	describe('getBaseUrl', () => {
		it('should construct URL from config serverUrl and repository name', () => {
			expect(service.getBaseUrl('my-repo')).toBe('http://localhost:3000/my-repo');
		});

		it('should strip trailing slashes from serverUrl', () => {
			config.serverUrl = 'http://localhost:3000/api/';

			const result = service.getBaseUrl('my-repo');

			expect(result).toBe('http://localhost:3000/api/my-repo');
		});

		it('should strip leading slashes from repository name', () => {
			expect(service.getBaseUrl('/my-repo/')).toBe('http://localhost:3000/my-repo/');
		});
	});

	describe('createSession', () => {
		it('should create session and return its id', async () => {
			mockAgent.createSession.mockResolvedValue({ id: 'session-1' });

			const result = await service.createSession('my-repo', 'Test Session');

			expect(mockAgent.createSession).toHaveBeenCalledWith('Test Session');
			expect(result).toBe('session-1');
		});
	});

	describe('promptAsync', () => {
		it('should call agent.promptAsync with tools', async () => {
			await service.promptAsync('my-repo', 'session-1', 'Hello', { tool1: true });

			expect(mockAgent.promptAsync).toHaveBeenCalledWith('session-1', 'Hello', {
				tools: { tool1: true },
			});
		});

		it('should call agent.promptAsync without tools when not provided', async () => {
			await service.promptAsync('my-repo', 'session-1', 'Hello');

			expect(mockAgent.promptAsync).toHaveBeenCalledWith('session-1', 'Hello', {
				tools: undefined,
			});
		});
	});

	describe('getEventsStream', () => {
		it('should return events stream from agent with options', async () => {
			const stream = (async function* stream() {
				/* Empty */
			})();
			mockAgent.getEventsStream.mockResolvedValue(stream);

			const result = await service.getEventsStream('my-repo', {
				signal: new AbortController().signal,
			});

			expect(mockAgent.getEventsStream).toHaveBeenCalledWith({
				signal: expect.any(AbortSignal),
			});
			expect(result).toBe(stream);
		});

		it('should call agent.getEventsStream without options when not provided', async () => {
			mockAgent.getEventsStream.mockResolvedValue(
				// oxlint-disable-next-line func-names
				(async function* () {
					/* Empty */
				})()
			);

			await service.getEventsStream('my-repo');

			expect(mockAgent.getEventsStream).toHaveBeenCalledWith(undefined);
		});
	});

	describe('getMessages', () => {
		it('should return messages from agent', async () => {
			const messages = [{ info: {} as any, parts: [] }];
			mockAgent.getMessages.mockResolvedValue(messages);

			const result = await service.getMessages('my-repo', 'session-1');

			expect(mockAgent.getMessages).toHaveBeenCalledWith('session-1');
			expect(result).toBe(messages);
		});
	});

	describe('isSessionFinished', () => {
		it('should return whether session is finished', async () => {
			mockAgent.isSessionFinished.mockResolvedValue(true);

			const result = await service.isSessionFinished('my-repo', 'session-1');

			expect(mockAgent.isSessionFinished).toHaveBeenCalledWith('session-1');
			expect(result).toBeTruthy();
		});
	});
});
