import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { IOpencodeEventProcessor } from '../interface';
import type { OpencodeEventReceived } from '../opencode-events.type';

import { OpencodeEventsInject } from '../opencode-events.enum';

@Injectable()
export class OpencodeEventListener {
	constructor(
		@Inject(OpencodeEventsInject.PROCESSOR)
		private readonly processor: IOpencodeEventProcessor
	) {}

	@OnEvent('opencode.event.received', { async: true })
	async handleOpencodeEvent(event: OpencodeEventReceived): Promise<void> {
		try {
			await this.processor.processEvent(event);
		} catch {
			// The processor logs its own errors.
		}
	}
}
