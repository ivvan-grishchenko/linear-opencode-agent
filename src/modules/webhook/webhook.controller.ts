import type {
	AgentSessionEventWebhookPayload,
	EntityWebhookPayloadWithUnknownEntityData,
} from '@linear/sdk';
import type { RawBodyRequest } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import { LinearConfig } from '@config/linear.config';
import {
	LINEAR_WEBHOOK_SIGNATURE_HEADER,
	LINEAR_WEBHOOK_TS_FIELD,
	LinearWebhookClient,
} from '@linear/sdk/webhooks';
import {
	BadRequestException,
	Controller,
	HttpCode,
	HttpStatus,
	Inject,
	Logger,
	Post,
	Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { IWebhookService } from './webhook.service.interface';

import { WebhookInject } from './webhook.enum';

type AgentSessionEventWebhookPayload$1 = AgentSessionEventWebhookPayload & {
	type: 'AgentSessionEvent';
};

@ApiTags('webhook')
@Controller('webhook')
export class WebhookController {
	private readonly logger = new Logger(WebhookController.name);

	private readonly linearWebhookClient!: LinearWebhookClient;

	constructor(
		@Inject(WebhookInject.SERVICE)
		private readonly service: IWebhookService,

		@Inject(LinearConfig.KEY)
		private readonly linearConfig: ConfigType<typeof LinearConfig>
	) {
		this.linearWebhookClient = new LinearWebhookClient(this.linearConfig.webhookSecret);
	}

	@Post()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		description:
			'Receives signed Linear webhooks (e.g. AgentSessionEvent), verifies them, and dispatches to the service layer.',
		summary: 'Linear webhook receiver',
	})
	@ApiResponse({ description: 'Webhook accepted (returns "ok").', status: HttpStatus.OK })
	@ApiResponse({
		description: 'Invalid signature, missing raw body, or processing error.',
		status: HttpStatus.BAD_REQUEST,
	})
	async webhook(@Req() request: RawBodyRequest<Request>) {
		if (!request.rawBody) {
			this.logger.error('Raw body is missing. ');
			throw new BadRequestException('Raw body is missing.');
		}

		const signature = request.get(LINEAR_WEBHOOK_SIGNATURE_HEADER) ?? '';
		const timestamp = request.get(LINEAR_WEBHOOK_TS_FIELD) ?? '';

		const payload = this.linearWebhookClient.parseData(request.rawBody, signature, timestamp);

		if (payload.type === 'AgentSessionEvent' && this.isAgentSessionPayload(payload))
			try {
				await this.service.handleAgentSessionPayload(payload);
			} catch (error) {
				this.logger.error('Error handling agent session', error);
				throw new BadRequestException('Error handling agent session');
			}

		return 'ok';
	}

	private isAgentSessionPayload(
		payload: EntityWebhookPayloadWithUnknownEntityData | AgentSessionEventWebhookPayload$1
	): payload is AgentSessionEventWebhookPayload$1 {
		return 'appUserId' in payload;
	}
}
