import type { Provider } from '@nestjs/common';

import { AgentSessionInject } from './agent-session.enum';
import { AgentSessionEventListener, AgentSessionEventProcessor } from './events';
import { AgentSessionRepository } from './repository';
import { AgentSessionPromptService, AgentSessionValidatorService } from './service';

const AgentSessionProcessorProvider: Provider = {
	provide: AgentSessionInject.PROCESSOR,
	useClass: AgentSessionEventProcessor,
};

const AgentSessionListenerProvider: Provider = {
	provide: AgentSessionInject.LISTENER,
	useClass: AgentSessionEventListener,
};

const AgentSessionValidatorServiceProvider: Provider = {
	provide: AgentSessionInject.VALIDATOR_SERVICE,
	useClass: AgentSessionValidatorService,
};

const AgentSessionRepositoryProvider: Provider = {
	provide: AgentSessionInject.REPOSITORY,
	useClass: AgentSessionRepository,
};

const AgentSessionPromptServiceProvider: Provider = {
	provide: AgentSessionInject.PROMPT_SERVICE,
	useClass: AgentSessionPromptService,
};

export {
	AgentSessionProcessorProvider,
	AgentSessionListenerProvider,
	AgentSessionValidatorServiceProvider,
	AgentSessionRepositoryProvider,
	AgentSessionPromptServiceProvider,
};
