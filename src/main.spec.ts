import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import './main';

const mockApp = vi.hoisted(() => ({
	enableShutdownHooks: vi.fn(),
	get: vi.fn().mockReturnValue({ port: 3_000 }),
	listen: vi.fn().mockResolvedValue(undefined),
}));

const mockRunMigrations = vi.hoisted(() => vi.fn());

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

	it('should enable shutdown hooks', () => {
		expect(mockApp.enableShutdownHooks).toHaveBeenCalledWith();
	});

	it('should listen on the configured port', () => {
		expect(mockApp.listen).toHaveBeenCalledWith(3_000);
	});
});
