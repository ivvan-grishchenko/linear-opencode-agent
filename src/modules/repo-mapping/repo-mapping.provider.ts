import type { Provider } from '@nestjs/common';

import { RepoMappingInject } from './repo-mapping.enum';
import { RepoMappingService } from './repo-mapping.service';
import { RepoMappingRepository } from './repository';

const RepoMappingServiceProvider: Provider = {
	provide: RepoMappingInject.SERVICE,
	useClass: RepoMappingService,
};

const RepoMappingRepositoryProvider: Provider = {
	provide: RepoMappingInject.REPOSITORY,
	useClass: RepoMappingRepository,
};

export { RepoMappingRepositoryProvider, RepoMappingServiceProvider };
