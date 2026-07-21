import type { Request, Response } from 'express';

import { Controller, Get, Header, HttpStatus, Inject, Req, Res } from '@nestjs/common';

import type { IOauthService } from './oauth.service.interface';

import { OauthInject } from './oauth.enum';

@Controller('oauth')
export class OauthController {
	constructor(
		@Inject(OauthInject.SERVICE)
		private readonly service: IOauthService
	) {}

	@Get('authorize')
	authorize(@Req() request: Request, @Res() response: Response) {
		const redirectUrl = this.service.getOauthAuthorizeRedirectUrl(request);

		return response.redirect(HttpStatus.FOUND, redirectUrl);
	}

	@Get('callback')
	@Header('Content-Type', 'text/html')
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
