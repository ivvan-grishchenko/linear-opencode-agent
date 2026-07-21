import type { LinearWebhookPayload } from '@linear/sdk/webhooks';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { Mock } from 'vitest';

import { LinearConfig } from '@config/linear.config';
import { LinearWebhookClient } from '@linear/sdk/webhooks';
import { BadRequestException } from '@nestjs/common';
import { type Mocked, TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IWebhookService } from './webhook.service.interface';

import { WebhookController } from './webhook.controller';
import { WebhookInject } from './webhook.enum';

describe('webhookController', () => {
	let webhookController: WebhookController;
	let service: Mocked<IWebhookService>;
	let parseDataSpy: Mock<
		(rawBody: Buffer, signature: string, timestamp?: number | string) => LinearWebhookPayload
	>;

	beforeEach(async () => {
		parseDataSpy = vi.spyOn(LinearWebhookClient.prototype, 'parseData');

		const { unit, unitRef } = await TestBed.solitary(WebhookController)
			.mock(LinearConfig.KEY)
			.final({ webhookSecret: 'linear_webhook_secret' })
			.compile();

		webhookController = unit;
		service = unitRef.get(WebhookInject.SERVICE);
	});

	afterEach(() => vi.resetAllMocks());

	it('should throw a bad request exception when there is no raw body', async () => {
		await expect(webhookController.webhook({} as Request)).rejects.toThrow(BadRequestException);
		expect(service.handleAgentSessionPayload).not.toHaveBeenCalled();
		expect(parseDataSpy).not.toHaveBeenCalled();
	});

	describe('request with raw body', () => {
		let request: RawBodyRequest<Request>;

		beforeEach(() => {
			request = {
				get: vi.fn(),
				rawBody: Buffer.from('body'),
			} as unknown as RawBodyRequest<Request>;
		});

		it('should fail when linear webhook client fails to parse data', async () => {
			parseDataSpy.mockThrow(new Error('Validation failed'));

			await expect(webhookController.webhook(request)).rejects.toThrow('Validation failed');
			expect(request.get).toHaveBeenCalledTimes(2);
			expect(parseDataSpy).toHaveBeenCalledWith(request.rawBody, '', '');
		});

		it('should return ok when data is parsed but incorrect payload', async () => {
			parseDataSpy.mockReturnValue({ action: 'action' } as LinearWebhookPayload);

			const response = await webhookController.webhook(request);

			expect(response).toBe('ok');
			expect(service.handleAgentSessionPayload).not.toHaveBeenCalled();
		});

		describe('returns correct payload', () => {
			let payload: LinearWebhookPayload;

			beforeEach(() => {
				payload = { appUserId: 'user-1', type: 'AgentSessionEvent' } as LinearWebhookPayload;
				parseDataSpy.mockReturnValue(payload);
			});

			it('should throw an error when fails to handle payload', async () => {
				await service.handleAgentSessionPayload.mockRejectedValue('Failed processing');

				await expect(webhookController.webhook(request)).rejects.toThrow(
					'Error handling agent session'
				);
				expect(service.handleAgentSessionPayload).toHaveBeenCalledWith(payload);
			});

			it('should return ok after processing correct payload', async () => {
				await service.handleAgentSessionPayload.mockResolvedValue();

				const response = await webhookController.webhook(request);

				expect(response).toBe('ok');
				expect(service.handleAgentSessionPayload).toHaveBeenCalledWith(payload);
			});
		});
	});
});
