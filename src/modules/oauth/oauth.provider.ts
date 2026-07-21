import type { Provider } from '@nestjs/common';

import { OauthInject } from './oauth.enum';
import { OauthService } from './oauth.service';

const OauthServiceProvider: Provider = {
	provide: OauthInject.SERVICE,
	useClass: OauthService,
};

export { OauthServiceProvider };
