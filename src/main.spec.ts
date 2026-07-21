import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import './main';

const mockApp = vi.hoisted(() => ({
	enableShutdownHooks: vi.fn(),
	get: vi.fn().mockReturnValue({ port: 3_000 }),
	listen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@nestjs/core', () => ({
	NestFactory: {
		create: vi.fn().mockResolvedValue(mockApp),
	},
}));

vi.mock('@config/app.config', () => ({
	AppConfig: { KEY: 'app' },
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

	it('should enable shutdown hooks', () => {
		expect(mockApp.enableShutdownHooks).toHaveBeenCalledWith();
	});

	it('should listen on the configured port', () => {
		expect(mockApp.listen).toHaveBeenCalledWith(3_000);
	});
});
