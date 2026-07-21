import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { ConfigTokenEnum } from './config.enum';

const AppConfigSchema = z.object({ appUrl: z.url(), port: z.number() });

type AppConfigType = z.infer<typeof AppConfigSchema>;

export const AppConfig = registerAs<AppConfigType>(ConfigTokenEnum.APP, () => {
	const config: AppConfigType = {
		appUrl: process.env.APP_URL as string,
		port: Number(process.env.APP_PORT as string),
	};

	return AppConfigSchema.parse(config);
});
