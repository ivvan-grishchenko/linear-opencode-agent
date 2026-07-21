import type { OpencodeEventReceived } from '../opencode-events.type';

export interface IOpencodeEventProcessor {
	processEvent(event: OpencodeEventReceived): Promise<void>;
}
