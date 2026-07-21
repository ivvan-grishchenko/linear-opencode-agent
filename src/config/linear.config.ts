import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { ConfigTokenEnum } from './config.enum';

const LinearConfigSchema = z.object({
	clientId: z.string(),
	clientSecret: z.string(),
	webhookSecret: z.string(),
});

type LinearConfigType = z.infer<typeof LinearConfigSchema>;

export const LinearConfig = registerAs<LinearConfigType>(ConfigTokenEnum.LINEAR, () => {
	const config: LinearConfigType = {
		clientId: process.env.LINEAR_CLIENT_ID as string,
		clientSecret: process.env.LINEAR_CLIENT_SECRET as string,
		webhookSecret: process.env.LINEAR_WEBHOOK_SECRET as string,
	};

	return LinearConfigSchema.parse(config);
});
