import { afterEach, describe, expect, it } from 'vitest';

import { OpencodeConfig } from './opencode.config';

describe('opencodeConfig', () => {
	afterEach(() => {
		delete process.env.OPENCODE_SERVER_PASSWORD;
		delete process.env.OPENCODE_SERVER_URL;
	});

	it('should parse and return valid config', () => {
		process.env.OPENCODE_SERVER_PASSWORD = 's3cret';
		process.env.OPENCODE_SERVER_URL = 'https://opencode.example.com';

		const config = OpencodeConfig();

		expect(config).toStrictEqual({
			serverPassword: 's3cret',
			serverUrl: 'https://opencode.example.com',
		});
	});

	it('should throw for invalid serverUrl', () => {
		process.env.OPENCODE_SERVER_PASSWORD = 's3cret';
		process.env.OPENCODE_SERVER_URL = 'not-a-url';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => OpencodeConfig()).toThrow();
	});

	it('should throw when any env var is missing', () => {
		process.env.OPENCODE_SERVER_PASSWORD = 's3cret';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => OpencodeConfig()).toThrow();
	});
});
