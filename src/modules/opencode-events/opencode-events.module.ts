import { DatabaseModule } from '@modules/database/database.module';
import { LinearModule } from '@modules/linear/linear.module';
import { OpencodeModule } from '@modules/opencode/opencode.module';
import { Module } from '@nestjs/common';

import {
	OpenCodeEventRepositoryProvider,
	OpencodeEventListenerProvider,
	OpencodeEventMapperServiceProvider,
	OpencodeEventProcessorProvider,
	OpencodeEventStreamServiceProvider,
} from './opencode-events.provider';

@Module({
	exports: [OpencodeEventStreamServiceProvider],
	imports: [DatabaseModule, LinearModule, OpencodeModule],
	providers: [
		OpencodeEventProcessorProvider,
		OpencodeEventListenerProvider,
		OpencodeEventStreamServiceProvider,
		OpencodeEventMapperServiceProvider,
		OpenCodeEventRepositoryProvider,
	],
})
export class OpencodeEventsModule {}
