export class Utils {
	static async runWithRetry<T>(fn: () => Promise<T>, retries = 2, sleepMs: number): Promise<T> {
		let lastError: unknown;

		for (let i = 0; i <= retries; i++) {
			try {
				return await fn();
			} catch (err) {
				lastError = err;

				if (i < retries) await Utils.sleep(sleepMs);
			}
		}

		throw lastError;
	}

	static sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
