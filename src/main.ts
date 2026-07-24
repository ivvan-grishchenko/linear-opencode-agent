import type { DatabaseClient } from '@modules/database';
import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppConfig } from '@config/app.config';
import { runMigrations } from '@db/migrate';
import { DatabaseInject } from '@modules/database';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

	const appConfig: ConfigType<typeof AppConfig> = app.get(AppConfig.KEY);
	const db = app.get<DatabaseClient>(DatabaseInject.CLIENT);

	await runMigrations(db);

	app.enableShutdownHooks();
	await app.listen(appConfig.port);
}

void bootstrap();
