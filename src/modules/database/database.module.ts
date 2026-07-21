import { Module } from '@nestjs/common';

import { DatabaseClientProvider } from './database.provider';

@Module({
	exports: [DatabaseClientProvider],
	providers: [DatabaseClientProvider],
})
export class DatabaseModule {}
