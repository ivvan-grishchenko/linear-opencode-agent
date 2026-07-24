import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import type { Mock } from 'vitest';

import { runMigrations } from '@db/migrate';
import { LinearWebhookClient } from '@linear/sdk/webhooks';
import { DatabaseInject } from '@modules/database';
import { OauthInject } from '@modules/oauth';
import { OpencodeEventsInject } from '@modules/opencode-events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';

vi.hoisted(() => {
	process.env.APP_URL = 'http://localhost:3000';
	process.env.APP_PORT = '0';
	process.env.DB_FILE_NAME = ':memory:';
	process.env.LINEAR_CLIENT_ID = 'test-client-id';
	process.env.LINEAR_CLIENT_SECRET = 'test-client-secret';
	process.env.LINEAR_WEBHOOK_SECRET = 'test-webhook-secret';
	process.env.OPENCODE_SERVER_URL = 'http://localhost:8080';
	process.env.OPENCODE_SERVER_PASSWORD = 'test-password';
});

function buildLinearOauthUrl(state?: string) {
	const authUrl = new URL('https://linear.app/oauth/authorize');

	authUrl.searchParams.set('client_id', 'test-client-id');
	authUrl.searchParams.set('redirect_uri', 'http://localhost:3000/oauth/callback');
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('scope', 'read,write,app:assignable,app:mentionable');
	authUrl.searchParams.set('actor', 'app');

	if (state) authUrl.searchParams.set('state', state);

	return authUrl.toString();
}

describe('app e2e', () => {
	let app: INestApplication;
	let parseDataSpy: Mock;

	const mockOauth = {
		getAccessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
		getOauthAuthorizeRedirectUrl: vi.fn(),
		handleOauthCallback: vi.fn(),
	};

	beforeAll(async () => {
		parseDataSpy = vi.spyOn(LinearWebhookClient.prototype, 'parseData');

		mockOauth.getOauthAuthorizeRedirectUrl.mockImplementation((req: Request) => {
			const url = new URL(req.url, 'http://localhost:3000');
			const state = url.searchParams.get('state') ?? undefined;

			return buildLinearOauthUrl(state);
		});

		mockOauth.handleOauthCallback.mockResolvedValue({
			workspaceId: 'test-workspace-id',
			workspaceName: 'Test Workspace',
		});

		const moduleFixture = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideProvider(OpencodeEventsInject.STREAM_SERVICE)
			.useValue({
				ensureStream: vi.fn(),
				onModuleInit: vi.fn(),
				releaseStream: vi.fn(),
			})
			.overrideProvider(OauthInject.SERVICE)
			.useValue(mockOauth)
			.compile();

		const emitter = moduleFixture.get(EventEmitter2);
		emitter.on('error', () => {});

		// oxlint-disable-next-line typescript/no-explicit-any
		const db = moduleFixture.get<any>(DatabaseInject.CLIENT);

		await runMigrations(db);

		app = moduleFixture.createNestApplication({ rawBody: true });
		await app.init();
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterAll(async () => {
		await app.close();
		vi.resetAllMocks();
	});

	describe('gET /health', () => {
		it('should return health check response with status and memory indicators', async () => {
			const response = await request(app.getHttpServer()).get('/health');

			expect([200, 503]).toContain(response.status);
			expect(response.body).toHaveProperty('status');

			const memoryHeap = response.body.info?.memory_heap || response.body.details?.memory_heap;
			const memoryRss = response.body.info?.memory_rss || response.body.error?.memory_rss;

			expect(memoryHeap).toBeDefined();
			expect(memoryRss).toBeDefined();
		});
	});

	describe('pOST /webhook', () => {
		it('should return 400 when raw body is missing', async () => {
			const response = await request(app.getHttpServer()).post('/webhook');

			expect(response.status).toBe(400);
			expect(response.body.message).toBe('Raw body is missing.');
		});

		it('should return 500 when signature verification fails', async () => {
			parseDataSpy.mockImplementation(() => {
				throw new Error('Invalid signature');
			});

			const response = await request(app.getHttpServer())
				.post('/webhook')
				.send({ type: 'test' })
				.set('Content-Type', 'application/json');

			expect(response.status).toBe(500);
		});

		it('should return 200 ok for non-agent-session webhook payloads', async () => {
			parseDataSpy.mockReturnValue({ action: 'create', type: 'Issue' });

			const response = await request(app.getHttpServer())
				.post('/webhook')
				.send({ type: 'test' })
				.set('Content-Type', 'application/json');

			expect(response.status).toBe(200);
			expect(response.text).toBe('ok');
		});

		it('should return 200 ok for a valid AgentSessionEvent delegation payload', async () => {
			const agentSessionId = `agent-session-delegation-${Date.now()}`;

			parseDataSpy.mockReturnValue({
				action: 'created',
				agentSession: { id: agentSessionId },
				appUserId: 'user-1',
				organizationId: 'org-1',
				type: 'AgentSessionEvent',
			});

			const response = await request(app.getHttpServer())
				.post('/webhook')
				.send({ type: 'test' })
				.set('Content-Type', 'application/json');

			expect(response.status).toBe(200);
			expect(response.text).toBe('ok');
		});

		it('should return 200 ok for a valid AgentSessionEvent mention payload', async () => {
			const agentSessionId = `agent-session-mention-${Date.now()}`;

			parseDataSpy.mockReturnValue({
				action: 'prompted',
				agentSession: { id: agentSessionId },
				appUserId: 'user-1',
				organizationId: 'org-1',
				type: 'AgentSessionEvent',
			});

			const response = await request(app.getHttpServer())
				.post('/webhook')
				.send({ type: 'test' })
				.set('Content-Type', 'application/json');

			expect(response.status).toBe(200);
			expect(response.text).toBe('ok');
		});

		it('should return 200 ok and deduplicate already-processed agent sessions', async () => {
			const agentSessionId = `agent-session-dup-${Date.now()}`;

			parseDataSpy.mockReturnValue({
				action: 'created',
				agentSession: { id: agentSessionId },
				appUserId: 'user-1',
				organizationId: 'org-1',
				type: 'AgentSessionEvent',
			});

			const first = await request(app.getHttpServer())
				.post('/webhook')
				.send({ type: 'test' })
				.set('Content-Type', 'application/json');

			expect(first.status).toBe(200);
			expect(first.text).toBe('ok');

			const second = await request(app.getHttpServer())
				.post('/webhook')
				.send({ type: 'test' })
				.set('Content-Type', 'application/json');

			expect(second.status).toBe(200);
			expect(second.text).toBe('ok');
		});
	});

	describe('gET /oauth/authorize', () => {
		it('should redirect to Linear OAuth authorize URL', async () => {
			const response = await request(app.getHttpServer()).get('/oauth/authorize');

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe(buildLinearOauthUrl());
		});

		it('should forward state parameter to Linear OAuth URL', async () => {
			const response = await request(app.getHttpServer()).get('/oauth/authorize?state=abc123');

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe(buildLinearOauthUrl('abc123'));
		});
	});

	describe('gET /oauth/callback', () => {
		it('should return 200 with workspace info HTML page', async () => {
			const response = await request(app.getHttpServer()).get('/oauth/callback?code=test-code');

			expect(response.status).toBe(200);
			expect(response.text).toContain('<h1>Authorization successful</h1>');
			expect(response.text).toContain('Test Workspace');
			expect(response.text).toContain('test-workspace-id');
		});

		it('should call handleOauthCallback with the request object', async () => {
			await request(app.getHttpServer()).get('/oauth/callback?code=test-code');

			expect(mockOauth.handleOauthCallback).toHaveBeenCalledTimes(1);
		});
	});
});
