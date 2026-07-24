import type { DatabaseClient } from '@modules/database';

import { migrate } from 'drizzle-orm/libsql/migrator';

// Programmatic migrations are applied on every application startup.
// See: https://orm.drizzle.team/docs/migrations
export async function runMigrations(db: DatabaseClient): Promise<void> {
	await migrate(db, { migrationsFolder: './drizzle' });
}
