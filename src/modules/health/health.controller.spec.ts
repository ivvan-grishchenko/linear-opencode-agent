import type { Mocked } from '@suites/unit';

import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthController } from './health.controller';

describe('healthController', () => {
	let controller: HealthController;
	let health: Mocked<HealthCheckService>;
	let memory: Mocked<MemoryHealthIndicator>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(HealthController).compile();

		controller = unit;
		health = unitRef.get(HealthCheckService);
		memory = unitRef.get(MemoryHealthIndicator);
	});

	afterEach(() => vi.resetAllMocks());

	describe('check', () => {
		it('should return health check result with memory indicators', async () => {
			const expected = { status: 'ok' };
			await health.check.mockReturnValue(expected as any);

			const result = controller.check();

			expect(result).toStrictEqual(expected);
			expect(health.check).toHaveBeenCalledTimes(1);
			// oxlint-disable-next-line prefer-destructuring
			const indicators = health.check.mock.calls[0][0];
			expect(indicators).toHaveLength(2);

			indicators[0]();
			expect(memory.checkHeap).toHaveBeenCalledWith('memory_heap', 150 * 1_024 * 1_024);

			indicators[1]();
			expect(memory.checkRSS).toHaveBeenCalledWith('memory_rss', 150 * 1_024 * 1_024);
		});
	});
});
