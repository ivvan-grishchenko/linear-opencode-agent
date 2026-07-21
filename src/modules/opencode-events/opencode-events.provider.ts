import type { Provider } from '@nestjs/common';

import { OpencodeEventListener, OpencodeEventProcessor } from './events';
import { OpencodeEventsInject } from './opencode-events.enum';
import { OpencodeEventRepository } from './repository';
import { OpencodeEventMapperService, OpencodeEventStreamService } from './service';

const OpencodeEventProcessorProvider: Provider = {
	provide: OpencodeEventsInject.PROCESSOR,
	useClass: OpencodeEventProcessor,
};

const OpencodeEventListenerProvider: Provider = {
	provide: OpencodeEventsInject.LISTENER,
	useClass: OpencodeEventListener,
};

const OpencodeEventStreamServiceProvider: Provider = {
	provide: OpencodeEventsInject.STREAM_SERVICE,
	useClass: OpencodeEventStreamService,
};

const OpencodeEventMapperServiceProvider: Provider = {
	provide: OpencodeEventsInject.MAPPER_SERVICE,
	useClass: OpencodeEventMapperService,
};

const OpenCodeEventRepositoryProvider: Provider = {
	provide: OpencodeEventsInject.REPOSITORY,
	useClass: OpencodeEventRepository,
};

export {
	OpencodeEventListenerProvider,
	OpencodeEventProcessorProvider,
	OpencodeEventStreamServiceProvider,
	OpencodeEventMapperServiceProvider,
	OpenCodeEventRepositoryProvider,
};
