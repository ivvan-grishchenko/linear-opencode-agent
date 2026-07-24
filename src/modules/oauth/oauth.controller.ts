import type { Request, Response } from 'express';

import { Controller, Get, Header, HttpStatus, Inject, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { IOauthService } from './oauth.service.interface';

import { OauthInject } from './oauth.enum';

@ApiTags('oauth')
@Controller('oauth')
export class OauthController {
	constructor(
		@Inject(OauthInject.SERVICE)
		private readonly service: IOauthService
	) {}

	@Get('authorize')
	@ApiOperation({
		description: 'Redirects the caller to the Linear OAuth authorization page.',
		summary: 'Start Linear OAuth flow',
	})
	@ApiResponse({
		description: 'Redirect to Linear OAuth authorize URL.',
		headers: {
			Location: {
				description: 'Linear OAuth authorize URL.',
				schema: {
					example: 'https://linear.app/oauth/authorize?...',
					format: 'uri',
					type: 'string',
				},
			},
		},
		status: HttpStatus.FOUND,
	})
	@ApiResponse({
		description: 'Failed to build the OAuth authorize URL.',
		status: HttpStatus.INTERNAL_SERVER_ERROR,
	})
	authorize(@Req() request: Request, @Res() response: Response) {
		const redirectUrl = this.service.getOauthAuthorizeRedirectUrl(request);

		return response.redirect(HttpStatus.FOUND, redirectUrl);
	}

	@Get('callback')
	@Header('Content-Type', 'text/html')
	@ApiOperation({
		description: 'Completes the Linear OAuth flow and renders a short HTML success page.',
		summary: 'Linear OAuth callback',
	})
	@ApiResponse({
		content: { 'text/html': { schema: { type: 'string' } } },
		description: 'HTML success page with workspace information.',
		status: HttpStatus.OK,
	})
	@ApiResponse({
		description: 'OAuth callback handling failed (e.g. code exchange error).',
		status: HttpStatus.INTERNAL_SERVER_ERROR,
	})
	async callback(@Req() request: Request, @Res() response: Response) {
		const { workspaceId, workspaceName } = await this.service.handleOauthCallback(request);

		const html = `<html lang="en"><body>
			<h1>Authorization successful</h1>
			<p>Workspace: <strong>${this.escapeHtml(workspaceName)}</strong></p>
			<p>Workspace ID: <code>${this.escapeHtml(workspaceId)}</code></p>
			<p>You can now assign issues or @mention the agent.</p>
		</body></html>`;

		return response.status(HttpStatus.OK).send(html);
	}

	private escapeHtml(value: string): string {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}
}
