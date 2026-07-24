import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import './main';

const mockApp = vi.hoisted(() => ({
	enableShutdownHooks: vi.fn(),
	get: vi.fn().mockReturnValue({ port: 3_000 }),
	listen: vi.fn().mockResolvedValue(undefined),
	use: vi.fn(),
}));

const mockRunMigrations = vi.hoisted(() => vi.fn());

const mockCreateDocument = vi.hoisted(() => vi.fn().mockReturnValue({ openapi: '3.1.0' }));
const mockCleanupOpenApiDoc = vi.hoisted(() => vi.fn((doc) => doc));

const mockApiReference = vi.hoisted(() => vi.fn().mockReturnValue('middleware'));

vi.mock('@nestjs/core', () => ({
	NestFactory: {
		create: vi.fn().mockResolvedValue(mockApp),
	},
}));

vi.mock('@config/app.config', () => ({
	AppConfig: { KEY: 'app' },
}));

vi.mock('@modules/database', () => ({
	DatabaseInject: { CLIENT: 'DatabaseClient' },
}));

vi.mock('@db/migrate', () => ({
	runMigrations: mockRunMigrations,
}));

vi.mock('@nestjs/swagger', () => ({
	DocumentBuilder: class {
		readonly #config: {
			description?: string;
			tags?: { description?: string; name: string }[];
			title?: string;
			version?: string;
		} = {};

		setTitle(value: string) {
			this.#config.title = value;
			return this;
		}

		setDescription(value: string) {
			this.#config.description = value;
			return this;
		}

		setVersion(value: string) {
			this.#config.version = value;
			return this;
		}

		addTag(name: string, description?: string) {
			(this.#config.tags ??= []).push({ description, name });
			return this;
		}

		build() {
			return this.#config;
		}
	},
	SwaggerModule: {
		createDocument: mockCreateDocument,
	},
}));

vi.mock('nestjs-zod', () => ({
	cleanupOpenApiDoc: mockCleanupOpenApiDoc,
}));

vi.mock('@scalar/nestjs-api-reference', () => ({
	apiReference: mockApiReference,
}));

vi.mock('./app.module', () => ({
	AppModule: class {},
}));

describe('bootstrap', () => {
	it('should create Nest application with AppModule and rawBody option', () => {
		expect(NestFactory.create).toHaveBeenCalledWith(expect.anything(), { rawBody: true });
	});

	it('should get app config using AppConfig.KEY', () => {
		expect(mockApp.get).toHaveBeenCalledWith('app');
	});

	it('should run migrations before starting the server', () => {
		expect(mockApp.get).toHaveBeenCalledWith('DatabaseClient');
		expect(mockRunMigrations).toHaveBeenCalledWith({ port: 3_000 });
	});

	it('should build the OpenAPI document and expose it as JSON', () => {
		expect(mockCreateDocument).toHaveBeenCalledWith(
			mockApp,
			expect.objectContaining({ title: 'linear-opencode-agent API' })
		);
		expect(mockCleanupOpenApiDoc).toHaveBeenCalledWith({ openapi: '3.1.0' });
	});

	it('should mount Scalar API reference at /reference', () => {
		expect(mockApiReference).toHaveBeenCalledWith(
			expect.objectContaining({ theme: 'purple', url: '/openapi.json' })
		);
		expect(mockApp.use).toHaveBeenCalledWith('/reference', 'middleware');
	});

	it('should enable shutdown hooks', () => {
		expect(mockApp.enableShutdownHooks).toHaveBeenCalledWith();
	});

	it('should listen on the configured port', () => {
		expect(mockApp.listen).toHaveBeenCalledWith(3_000);
	});
});
