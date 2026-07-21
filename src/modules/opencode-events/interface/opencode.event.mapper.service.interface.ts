import type { ActivityContent } from '@modules/linear';
import type { Event, Part } from '@opencode-ai/sdk';

import type { TranslateContext } from '../opencode-events.type';

export interface IOpencodeEventMapperService {
	translatePart(part: Part, context: TranslateContext): ActivityContent | null;
	extractSessionId(event: Event): string | undefined;
}
