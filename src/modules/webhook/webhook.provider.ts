import type { Provider } from '@nestjs/common';

import { WebhookInject } from './webhook.enum';
import { WebhookService } from './webhook.service';

export const WebhookServiceProvider: Provider = {
	provide: WebhookInject.SERVICE,
	useClass: WebhookService,
};
