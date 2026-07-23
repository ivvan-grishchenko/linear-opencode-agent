import type { INestApplication } from '@nestjs/common';

import { DatabaseInject } from '@modules/database';
import { OauthInject } from '@modules/oauth';
import { OpencodeEventsInject } from '@modules/opencode-events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
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

const TABLES_SQL = [
	`CREATE TABLE IF NOT EXISTS oauth_tokens (
		workspace_id text PRIMARY KEY NOT NULL,
		workspace_name text NOT NULL,
		access_token text NOT NULL,
		refresh_token text NOT NULL,
		expires_at integer NOT NULL,
		updated_at integer NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS repo_mappings (
		created_at integer NOT NULL,
		organization_id text NOT NULL,
		project_id text NOT NULL,
		repository_name text NOT NULL,
		updated_at integer NOT NULL,
		PRIMARY KEY(organization_id, project_id)
	)`,
	`CREATE TABLE IF NOT EXISTS agent_sessions (
		agent_session_id text PRIMARY KEY NOT NULL,
		created_at integer NOT NULL,
		error_message text,
		issue_id text,
		open_code_base_url text,
		open_code_session_id text,
		organization_id text NOT NULL,
		repository_name text,
		status text NOT NULL,
		updated_at integer NOT NULL,
		mode text DEFAULT 'mention' NOT NULL
	)`,
];

describe('repo-mapping e2e', () => {
	let app: INestApplication;

	beforeAll(async () => {
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
			.useValue({
				getAccessToken: vi.fn().mockResolvedValue(null),
				getOauthAuthorizeRedirectUrl: vi.fn(),
				handleOauthCallback: vi.fn(),
			})
			.compile();

		const emitter = moduleFixture.get(EventEmitter2);
		emitter.on('error', () => {});

		// oxlint-disable-next-line typescript/no-explicit-any
		const db = moduleFixture.get<any>(DatabaseInject.CLIENT);

		// oxlint-disable-next-line no-await-in-loop
		for (const tableSql of TABLES_SQL) await db.run(sql.raw(tableSql));

		app = moduleFixture.createNestApplication();
		await app.init();
	});

	beforeEach(async () => {
		// oxlint-disable-next-line typescript/no-explicit-any
		const db = app.get<any>(DatabaseInject.CLIENT);
		await db.run(sql.raw('DELETE FROM repo_mappings'));
	});

	afterAll(async () => {
		await app.close();
		vi.resetAllMocks();
	});

	describe('gET /repo-mappings', () => {
		it('should return empty array when no mappings exist', async () => {
			const response = await request(app.getHttpServer()).get('/repo-mappings');

			expect(response.status).toBe(200);
			expect(response.body).toStrictEqual([]);
		});

		it('should return all mappings', async () => {
			await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});

			await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-2',
				projectId: 'proj-2',
				repositoryName: 'repo-2',
			});

			const response = await request(app.getHttpServer()).get('/repo-mappings');

			expect(response.status).toBe(200);
			expect(response.body).toHaveLength(2);
		});

		it('should filter by organizationId', async () => {
			await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});

			await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-2',
				projectId: 'proj-2',
				repositoryName: 'repo-2',
			});

			const response = await request(app.getHttpServer()).get(
				'/repo-mappings?organizationId=org-1'
			);

			expect(response.status).toBe(200);
			expect(response.body).toHaveLength(1);
			expect(response.body[0].organizationId).toBe('org-1');
		});
	});

	describe('gET /repo-mappings/:organizationId/:projectId', () => {
		it('should return 404 when mapping does not exist', async () => {
			const response = await request(app.getHttpServer()).get('/repo-mappings/org-1/proj-1');

			expect(response.status).toBe(404);
		});

		it('should return the mapping when it exists', async () => {
			await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});

			const response = await request(app.getHttpServer()).get('/repo-mappings/org-1/proj-1');

			expect(response.status).toBe(200);
			expect(response.body.organizationId).toBe('org-1');
			expect(response.body.projectId).toBe('proj-1');
			expect(response.body.repositoryName).toBe('repo-1');
			expect(response.body.createdAt).toBeDefined();
			expect(response.body.updatedAt).toBeDefined();
		});
	});

	describe('pOST /repo-mappings', () => {
		it('should return 400 when body is invalid', async () => {
			const response = await request(app.getHttpServer())
				.post('/repo-mappings')
				.send({ organizationId: 'org-1' });

			expect(response.status).toBe(400);
		});

		it('should create a mapping and return 201', async () => {
			const response = await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});

			expect(response.status).toBe(201);
			expect(response.body.organizationId).toBe('org-1');
			expect(response.body.projectId).toBe('proj-1');
			expect(response.body.repositoryName).toBe('repo-1');
			expect(response.body.createdAt).toBeDefined();
			expect(response.body.updatedAt).toBeDefined();
		});

		it('should return 409 when mapping already exists', async () => {
			await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});

			const response = await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});

			expect(response.status).toBe(409);
		});
	});

	describe('pUT /repo-mappings/:organizationId/:projectId', () => {
		it('should return 404 when mapping does not exist', async () => {
			const response = await request(app.getHttpServer())
				.put('/repo-mappings/org-1/proj-1')
				.send({ repositoryName: 'new-repo' });

			expect(response.status).toBe(404);
		});

		it('should return 400 when body is invalid', async () => {
			const response = await request(app.getHttpServer())
				.put('/repo-mappings/org-1/proj-1')
				.send({});

			expect(response.status).toBe(400);
		});

		it('should update the mapping and return 200', async () => {
			await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});

			const response = await request(app.getHttpServer())
				.put('/repo-mappings/org-1/proj-1')
				.send({ repositoryName: 'new-repo' });

			expect(response.status).toBe(200);
			expect(response.body.repositoryName).toBe('new-repo');
			expect(response.body.organizationId).toBe('org-1');
			expect(response.body.projectId).toBe('proj-1');
		});
	});

	describe('dELETE /repo-mappings/:organizationId/:projectId', () => {
		it('should return 404 when mapping does not exist', async () => {
			const response = await request(app.getHttpServer()).delete('/repo-mappings/org-1/proj-1');

			expect(response.status).toBe(404);
		});

		it('should delete the mapping and return 204', async () => {
			await request(app.getHttpServer()).post('/repo-mappings').send({
				organizationId: 'org-1',
				projectId: 'proj-1',
				repositoryName: 'repo-1',
			});

			const deleteResponse = await request(app.getHttpServer()).delete(
				'/repo-mappings/org-1/proj-1'
			);

			expect(deleteResponse.status).toBe(204);

			const getResponse = await request(app.getHttpServer()).get('/repo-mappings/org-1/proj-1');

			expect(getResponse.status).toBe(404);
		});
	});
});
