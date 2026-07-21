import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseConfig } from './database.config';

describe('databaseConfig', () => {
	afterEach(() => {
		delete process.env.DB_FILE_NAME;
	});

	it('should parse and return valid config', () => {
		process.env.DB_FILE_NAME = 'test.db';

		const config = DatabaseConfig();

		expect(config).toStrictEqual({ dbFileName: 'test.db' });
	});

	it('should throw when DB_FILE_NAME is missing', () => {
		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => DatabaseConfig()).toThrow();
	});
});
