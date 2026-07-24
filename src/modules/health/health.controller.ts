import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
// oxlint-disable-next-line typescript/consistent-type-imports
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';

@ApiTags('health')
@Controller('health')
export class HealthController {
	// oxlint-disable-next-line no-magic-numbers
	private readonly MEMORY_THRESHOLD = 150 * 1_024 * 1_024;

	constructor(
		private readonly health: HealthCheckService,
		private readonly memory: MemoryHealthIndicator
	) {}

	@Get()
	@HealthCheck()
	@ApiOperation({
		description: 'Liveness probe plus a memory heap/RSS check against a 150 MiB threshold.',
		summary: 'Service health',
	})
	@ApiResponse({
		description: 'Service is healthy.',
		schema: {
			additionalProperties: true,
			example: {
				info: { memory_heap: { status: 'up' }, memory_rss: { status: 'up' } },
				status: 'ok',
			},
			properties: {
				details: { additionalProperties: true, type: 'object' },
				error: { additionalProperties: true, type: 'object' },
				info: { additionalProperties: true, type: 'object' },
				status: { example: 'ok', type: 'string' },
			},
			required: ['status'],
			type: 'object',
		},
		status: HttpStatus.OK,
	})
	@ApiResponse({
		description: 'Memory threshold exceeded or another health indicator failed.',
		status: HttpStatus.SERVICE_UNAVAILABLE,
	})
	check() {
		return this.health.check([
			() => this.memory.checkHeap('memory_heap', this.MEMORY_THRESHOLD),
			() => this.memory.checkRSS('memory_rss', this.MEMORY_THRESHOLD),
		]);
	}
}
