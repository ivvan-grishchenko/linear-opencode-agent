import type { Provider } from '@nestjs/common';

import { OpencodeInject } from './opencode.enum';
import { OpencodeService } from './opencode.service';

export const OpencodeServiceProvider: Provider = {
	provide: OpencodeInject.SERVICE,
	useClass: OpencodeService,
};
