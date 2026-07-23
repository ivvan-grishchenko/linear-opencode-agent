import { DatabaseModule } from '@modules/database/database.module';
import { Module } from '@nestjs/common';

import { RepoMappingController } from './repo-mapping.controller';
import { RepoMappingRepositoryProvider, RepoMappingServiceProvider } from './repo-mapping.provider';

@Module({
	controllers: [RepoMappingController],
	exports: [RepoMappingServiceProvider],
	imports: [DatabaseModule],
	providers: [RepoMappingServiceProvider, RepoMappingRepositoryProvider],
})
export class RepoMappingModule {}
