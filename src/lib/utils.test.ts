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

	describe('runWithRetry', () => {
		beforeEach(() => {
			vi.spyOn(Utils, 'sleep').mockResolvedValue();
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('returns the result on first success', async () => {
			const fn = vi.fn().mockResolvedValue('ok');
			const result = await Utils.runWithRetry(fn, 2, 100);
			expect(result).toBe('ok');
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('retries on failure and eventually succeeds', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new Error('fail1'))
				.mockRejectedValueOnce(new Error('fail2'))
				.mockResolvedValue('recovered');
			const result = await Utils.runWithRetry(fn, 2, 100);
			expect(result).toBe('recovered');
			expect(fn).toHaveBeenCalledTimes(3);
		});

		it('throws if all retries are exhausted', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('persistent'));
			await expect(Utils.runWithRetry(fn, 2, 100)).rejects.toThrow('persistent');
			expect(fn).toHaveBeenCalledTimes(3);
		});

		it('sleeps between retries', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new Error('fail'))
				.mockRejectedValueOnce(new Error('fail'))
				.mockResolvedValue('ok');
			await Utils.runWithRetry(fn, 2, 500);
			expect(Utils.sleep).toHaveBeenCalledTimes(2);
			expect(Utils.sleep).toHaveBeenCalledWith(500);
		});

		it('handles zero retries (no retry on failure)', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('no retry'));
			await expect(Utils.runWithRetry(fn, 0, 100)).rejects.toThrow('no retry');
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('does not sleep on the final failed attempt', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('fail'));
			await expect(Utils.runWithRetry(fn, 2, 100)).rejects.toThrow('fail');
			expect(Utils.sleep).toHaveBeenCalledTimes(2);
			expect(fn).toHaveBeenCalledTimes(3);
		});
	});
});
