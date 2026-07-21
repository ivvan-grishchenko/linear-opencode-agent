import type { Mocked } from '@suites/unit';

import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IOpencodeEventProcessor } from '../interface';
import type { OpencodeEventReceived } from '../opencode-events.type';

import { OpencodeEventsInject } from '../opencode-events.enum';
import { OpencodeEventListener } from './opencode.event.listener';

describe('opencodeEventListener', () => {
	let eventListener: OpencodeEventListener;
	let processor: Mocked<IOpencodeEventProcessor>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(OpencodeEventListener).compile();

		eventListener = unit;
		processor = unitRef.get(OpencodeEventsInject.PROCESSOR);
	});

	afterEach(() => vi.resetAllMocks());

	describe('handleOpencodeEvent', () => {
		let event: OpencodeEventReceived;

		beforeEach(() => {
			event = {} as OpencodeEventReceived;
		});

		it('should resolve when processor fails', async () => {
			await processor.processEvent.mockRejectedValue('Failed processing event');

			await expect(eventListener.handleOpencodeEvent(event)).resolves.toBeUndefined();
			expect(processor.processEvent).toHaveBeenCalledWith(event);
		});

		it('should resolve when processor succeeds', async () => {
			await processor.processEvent.mockResolvedValue();

			await expect(eventListener.handleOpencodeEvent(event)).resolves.toBeUndefined();
			expect(processor.processEvent).toHaveBeenCalledWith(event);
		});
	});
});
