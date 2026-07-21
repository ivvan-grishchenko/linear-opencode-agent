import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { ConfigTokenEnum } from './config.enum';

const OpencodeConfigSchema = z.object({
	serverPassword: z.string(),
	serverUrl: z.url(),
});

type OpencodeConfigType = z.infer<typeof OpencodeConfigSchema>;

export const OpencodeConfig = registerAs<OpencodeConfigType>(ConfigTokenEnum.OPENCODE, () => {
	const config: OpencodeConfigType = {
		serverPassword: process.env.OPENCODE_SERVER_PASSWORD as string,
		serverUrl: process.env.OPENCODE_SERVER_URL as string,
	};

	return OpencodeConfigSchema.parse(config);
});
