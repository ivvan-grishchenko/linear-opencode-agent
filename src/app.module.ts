import { AppConfig } from '@config/app.config';
import { DatabaseConfig } from '@config/database.config';
import { LinearConfig } from '@config/linear.config';
import { OpencodeConfig } from '@config/opencode.config';
import { AgentSessionModule } from '@modules/agent-session/agent-session.module';
import { HealthModule } from '@modules/health/health.module';
import { OauthModule } from '@modules/oauth/oauth.module';
import { OpencodeEventsModule } from '@modules/opencode-events/opencode-events.module';
import { RepoMappingModule } from '@modules/repo-mapping/repo-mapping.module';
import { WebhookModule } from '@modules/webhook/webhook.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
	imports: [
		ConfigModule.forRoot({
			cache: true,
			isGlobal: true,
			load: [AppConfig, DatabaseConfig, LinearConfig, OpencodeConfig],
		}),
		EventEmitterModule.forRoot(),

		AgentSessionModule,
		HealthModule,
		OauthModule,
		OpencodeEventsModule,
		RepoMappingModule,
		WebhookModule,
	],
})
export class AppModule {}
