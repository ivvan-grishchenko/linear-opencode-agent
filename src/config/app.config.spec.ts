import { afterEach, describe, expect, it } from 'vitest';

import { AppConfig } from './app.config';

describe('appConfig', () => {
	afterEach(() => {
		delete process.env.APP_URL;
		delete process.env.APP_PORT;
	});

	it('should parse and return valid config', () => {
		process.env.APP_URL = 'https://example.com';
		process.env.APP_PORT = '4000';

		const config = AppConfig();

		expect(config).toStrictEqual({
			appUrl: 'https://example.com',
			port: 4_000,
		});
	});

	it('should throw for invalid appUrl', () => {
		process.env.APP_URL = 'not-a-url';
		process.env.APP_PORT = '4000';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => AppConfig()).toThrow();
	});

	it('should throw for NaN port', () => {
		process.env.APP_URL = 'https://example.com';
		process.env.APP_PORT = 'not-a-number';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => AppConfig()).toThrow();
	});
});
