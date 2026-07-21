import { DatabaseModule } from '@modules/database/database.module';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { OauthController } from './oauth.controller';
import { OauthServiceProvider } from './oauth.provider';

const HTTP_TIMEOUT = 5_000;

@Module({
	controllers: [OauthController],
	exports: [OauthServiceProvider],
	imports: [HttpModule.register({ timeout: HTTP_TIMEOUT }), DatabaseModule],
	providers: [OauthServiceProvider],
})
export class OauthModule {}
