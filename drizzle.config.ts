import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dbCredentials: {
		url: process.env.DB_FILE_NAME!,
	},
	dialect: 'sqlite',
	out: './drizzle',
	schema: './src/db/schema.ts',
});
