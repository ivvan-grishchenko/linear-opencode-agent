import type { Provider } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { DatabaseConfig } from '@config/database.config';
// oxlint-disable-next-line import/no-namespace
import * as schema from '@db/schema';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

import { DatabaseInject } from './database.enum';

const DatabaseClientProvider: Provider = {
	inject: [DatabaseConfig.KEY],
	provide: DatabaseInject.CLIENT,
	useFactory: (databaseConfig: ConfigType<typeof DatabaseConfig>) => {
		const client = createClient({ url: databaseConfig.dbFileName });

		return drizzle({ client, schema });
	},
};

export { DatabaseClientProvider };
