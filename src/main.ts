import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppConfig } from '@config/app.config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

	const appConfig: ConfigType<typeof AppConfig> = app.get(AppConfig.KEY);

	app.enableShutdownHooks();
	await app.listen(appConfig.port);
}

void bootstrap();
