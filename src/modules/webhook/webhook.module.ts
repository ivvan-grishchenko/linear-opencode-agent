import { DatabaseModule } from '@modules/database/database.module';
import { Module } from '@nestjs/common';

import { WebhookController } from './webhook.controller';
import { WebhookServiceProvider } from './webhook.provider';

@Module({
	controllers: [WebhookController],
	imports: [DatabaseModule],
	providers: [WebhookServiceProvider],
})
export class WebhookModule {}
