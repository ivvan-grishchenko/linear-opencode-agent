import type { DatabaseClient } from '@modules/database';
import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppConfig } from '@config/app.config';
import { runMigrations } from '@db/migrate';
import { DatabaseInject } from '@modules/database';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

	const appConfig: ConfigType<typeof AppConfig> = app.get(AppConfig.KEY);
	const db = app.get<DatabaseClient>(DatabaseInject.CLIENT);

	await runMigrations(db);

	const openApiConfig = new DocumentBuilder()
		.setTitle('linear-opencode-agent API')
		.setDescription(
			'HTTP API for the Linear AI agent — assigns issues to opencode, exposes repo mappings, and handles Linear webhooks + OAuth.'
		)
		.setVersion(process.env.npm_package_version || '1.0.0')
		.addTag('repo-mappings', 'CRUD for repository mappings linking Linear projects to git repos')
		.addTag('health', 'Liveness / health probe')
		.addTag('oauth', 'Linear OAuth flow (authorize + callback)')
		.addTag('webhook', 'Linear webhook receiver')
		.build();

  const openApiDocument = SwaggerModule.createDocument(app,  openApiConfig);
  const scalarContent = cleanupOpenApiDoc(openApiDocument);

	app.use('/docs', apiReference({ content: scalarContent }));

	app.enableShutdownHooks();
	await app.listen(appConfig.port);
}

void bootstrap();
