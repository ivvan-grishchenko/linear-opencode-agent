// oxlint-disable-next-line import/no-namespace
import type * as schema from '@db/schema';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

type DatabaseClient = LibSQLDatabase<typeof schema>;

export type { DatabaseClient };
