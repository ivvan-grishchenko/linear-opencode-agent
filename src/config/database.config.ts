import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { ConfigTokenEnum } from './config.enum';

const DatabaseConfigSchema = z.object({
	dbFileName: z.string(),
});

type DatabaseConfigType = z.infer<typeof DatabaseConfigSchema>;

export const DatabaseConfig = registerAs<DatabaseConfigType>(ConfigTokenEnum.DATABASE, () => {
	const config: DatabaseConfigType = {
		dbFileName: process.env.DB_FILE_NAME as string,
	};

	return DatabaseConfigSchema.parse(config);
});
