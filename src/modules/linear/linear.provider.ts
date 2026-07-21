import type { Provider } from '@nestjs/common';

import { LinearInject } from './linear.enum';
import { LinearService } from './linear.service';

export const LinearServiceProvider: Provider = {
	provide: LinearInject.SERVICE,
	useClass: LinearService,
};
