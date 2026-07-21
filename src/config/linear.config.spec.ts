import { afterEach, describe, expect, it } from 'vitest';

import { LinearConfig } from './linear.config';

describe('linearConfig', () => {
	afterEach(() => {
		delete process.env.LINEAR_CLIENT_ID;
		delete process.env.LINEAR_CLIENT_SECRET;
		delete process.env.LINEAR_WEBHOOK_SECRET;
	});

	it('should parse and return valid config', () => {
		process.env.LINEAR_CLIENT_ID = 'client-id';
		process.env.LINEAR_CLIENT_SECRET = 'client-secret';
		process.env.LINEAR_WEBHOOK_SECRET = 'webhook-secret';

		const config = LinearConfig();

		expect(config).toStrictEqual({
			clientId: 'client-id',
			clientSecret: 'client-secret',
			webhookSecret: 'webhook-secret',
		});
	});

	it('should throw when any env var is missing', () => {
		process.env.LINEAR_CLIENT_ID = 'client-id';
		process.env.LINEAR_CLIENT_SECRET = 'client-secret';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => LinearConfig()).toThrow();
	});
});
