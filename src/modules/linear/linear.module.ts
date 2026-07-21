import { OauthModule } from '@modules/oauth/oauth.module';
import { Module } from '@nestjs/common';

import { LinearServiceProvider } from './linear.provider';

@Module({
	exports: [LinearServiceProvider],
	imports: [OauthModule],
	providers: [LinearServiceProvider],
})
export class LinearModule {}
