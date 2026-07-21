import { DatabaseModule } from '@modules/database/database.module';
import { LinearModule } from '@modules/linear/linear.module';
import { OpencodeEventsModule } from '@modules/opencode-events/opencode-events.module';
import { OpencodeModule } from '@modules/opencode/opencode.module';
import { Module } from '@nestjs/common';

import {
	AgentSessionListenerProvider,
	AgentSessionProcessorProvider,
	AgentSessionPromptServiceProvider,
	AgentSessionRepositoryProvider,
	AgentSessionValidatorServiceProvider,
} from './agent-session.provider';

@Module({
	exports: [AgentSessionProcessorProvider],
	imports: [DatabaseModule, LinearModule, OpencodeModule, OpencodeEventsModule],
	providers: [
		AgentSessionProcessorProvider,
		AgentSessionListenerProvider,
		AgentSessionValidatorServiceProvider,
		AgentSessionRepositoryProvider,
		AgentSessionPromptServiceProvider,
	],
})
export class AgentSessionModule {}
