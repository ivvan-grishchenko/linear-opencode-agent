import { Controller, Get } from '@nestjs/common';
// oxlint-disable-next-line typescript/consistent-type-imports
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';

// oxlint-disable-next-line capitalized-comments
/* v8 ignore start -- @preserve */
@Controller('health')
export class HealthController {
	// oxlint-disable-next-line capitalized-comments
	/* v8 ignore stop -- @preserve */
	// oxlint-disable-next-line no-magic-numbers
	private readonly MEMORY_THRESHOLD = 150 * 1_024 * 1_024;

	constructor(
		private readonly health: HealthCheckService,
		private readonly memory: MemoryHealthIndicator
	) {}

	@Get()
	@HealthCheck()
	check() {
		return this.health.check([
			() => this.memory.checkHeap('memory_heap', this.MEMORY_THRESHOLD),
			() => this.memory.checkRSS('memory_rss', this.MEMORY_THRESHOLD),
		]);
	}
}
