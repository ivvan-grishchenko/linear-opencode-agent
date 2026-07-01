import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { Utils } from './utils';

describe('Utils', () => {
	describe('sleep', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('resolves after the specified delay', async () => {
			const sleepPromise = Utils.sleep(1000);
			await vi.advanceTimersByTimeAsync(1000);
			await expect(sleepPromise).resolves.toBeUndefined();
		});

		it('does not resolve before the delay elapses', async () => {
			let resolved = false;
			Utils.sleep(1000).then(() => {
				resolved = true;
			});
			await vi.advanceTimersByTimeAsync(999);
			expect(resolved).toBe(false);
		});

		it('works with zero delay', async () => {
			const sleepPromise = Utils.sleep(0);
			await vi.advanceTimersByTimeAsync(0);
			await expect(sleepPromise).resolves.toBeUndefined();
		});
	});
});
