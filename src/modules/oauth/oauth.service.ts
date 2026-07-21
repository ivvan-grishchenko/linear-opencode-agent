import type { DatabaseClient } from '@modules/database';
import type { ConfigType } from '@nestjs/config';
import type { AxiosError } from 'axios';
import type { Request } from 'express';

import { AppConfig } from '@config/app.config';
import { LinearConfig } from '@config/linear.config';
import { oauthTokens } from '@db/schema';
import { LinearClient } from '@linear/sdk';
import { DatabaseInject } from '@modules/database';
// oxlint-disable-next-line typescript/consistent-type-imports
import { HttpService } from '@nestjs/axios';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { addSeconds, isBefore, subMilliseconds } from 'date-fns';
import { eq } from 'drizzle-orm';
import ms from 'ms';
import { catchError, firstValueFrom } from 'rxjs';

import type { IOauthService } from './oauth.service.interface';

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

@Injectable()
export class OauthService implements IOauthService {
	private readonly logger = new Logger(OauthService.name);

	private readonly TOKEN_URL = 'https://api.linear.app/oauth/token';
	private readonly SCOPES = 'read,write,app:assignable,app:mentionable';
	private readonly REFRESH_BUFFER_MS = ms('5m');

	constructor(
		@Inject(AppConfig.KEY)
		private readonly appConfig: ConfigType<typeof AppConfig>,
		@Inject(LinearConfig.KEY)
		private readonly linearConfig: ConfigType<typeof LinearConfig>,

		@Inject(DatabaseInject.CLIENT)
		private readonly db: DatabaseClient,

		private readonly httpService: HttpService
	) {}

	getOauthAuthorizeRedirectUrl(request: Request): string {
		const url = new URL(request.url, this.appConfig.appUrl);
		const state = url.searchParams.get('state') ?? '';

		const authUrl = new URL('https://linear.app/oauth/authorize');

		authUrl.searchParams.set('client_id', this.linearConfig.clientId);
		authUrl.searchParams.set('redirect_uri', `${this.appConfig.appUrl}/oauth/callback`);
		authUrl.searchParams.set('response_type', 'code');
		authUrl.searchParams.set('scope', this.SCOPES);
		authUrl.searchParams.set('actor', 'app');

		if (state) authUrl.searchParams.set('state', state);

		return authUrl.toString();
	}

	async handleOauthCallback(
		request: Request
	): Promise<{ workspaceId: string; workspaceName: string }> {
		const url = new URL(request.url, this.appConfig.appUrl);
		const code = url.searchParams.get('code');
		const error = url.searchParams.get('error');

		if (error) throw new BadRequestException(`OAuth error: ${error}`);

		if (!code) throw new BadRequestException('Missing authorization code');

		const tokenData = await this.exchangeCode(code);
		const workspaceInfo = await this.getWorkspaceInfo(tokenData.access_token);

		const now = Date.now();
		const expiresAt = addSeconds(now, tokenData.expires_in).getTime();

		await this.db
			.insert(oauthTokens)
			.values({
				accessToken: tokenData.access_token,
				expiresAt,
				refreshToken: tokenData.refresh_token,
				updatedAt: now,
				workspaceId: workspaceInfo.id,
				workspaceName: workspaceInfo.name,
			})
			.onConflictDoUpdate({
				set: {
					accessToken: tokenData.access_token,
					expiresAt,
					refreshToken: tokenData.refresh_token,
					updatedAt: now,
					workspaceName: workspaceInfo.name,
				},
				target: oauthTokens.workspaceId,
			});

		return { workspaceId: workspaceInfo.id, workspaceName: workspaceInfo.name };
	}

	async getAccessToken(workspaceId: string): Promise<string | null> {
		const rows = await this.db
			.select()
			.from(oauthTokens)
			.where(eq(oauthTokens.workspaceId, workspaceId));

		const [token] = rows;

		if (!token) return null;

		const refreshThreshold = subMilliseconds(new Date(token.expiresAt), this.REFRESH_BUFFER_MS);

		if (isBefore(new Date(), refreshThreshold)) return token.accessToken;

		if (!token.refreshToken) return null;

		try {
			const refreshed = await this.refreshAccessToken(token.refreshToken);
			const now = new Date();
			const expiresAt = addSeconds(now, refreshed.expires_in).getTime();

			await this.db
				.update(oauthTokens)
				.set({
					accessToken: refreshed.access_token,
					expiresAt,
					refreshToken: refreshed.refresh_token,
					updatedAt: now.getTime(),
				})
				.where(eq(oauthTokens.workspaceId, workspaceId));

			return refreshed.access_token;
		} catch (error) {
			this.logger.error('Failed to refresh access token:', error);

			return null;
		}
	}

	private async exchangeCode(code: string): Promise<TokenResponse> {
		try {
			const { data } = await firstValueFrom(
				this.httpService
					.post<TokenResponse>(
						this.TOKEN_URL,
						new URLSearchParams({
							client_id: this.linearConfig.clientId,
							client_secret: this.linearConfig.clientSecret,
							code,
							grant_type: 'authorization_code',
							redirect_uri: `${this.appConfig.appUrl}/oauth/callback`,
						}),
						{ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
					)
					.pipe(
						catchError((error: unknown) => {
							this.logger.error(error);
							throw new BadRequestException(
								`Token exchange failed: ${this.formatHttpError(error)}`
							);
						})
					)
			);

			return data;
		} catch (error) {
			if (error instanceof BadRequestException) throw error;

			this.logger.error(error);
			throw new BadRequestException('Token exchange failed');
		}
	}

	private async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
		const { data } = await firstValueFrom(
			this.httpService
				.post<TokenResponse>(
					this.TOKEN_URL,
					new URLSearchParams({
						client_id: this.linearConfig.clientId,
						client_secret: this.linearConfig.clientSecret,
						grant_type: 'refresh_token',
						refresh_token: refreshToken,
					}),
					{ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
				)
				.pipe(
					catchError((error: unknown) => {
						this.logger.error(error);
						throw new BadRequestException(`Token refresh failed: ${this.formatHttpError(error)}`);
					})
				)
		);

		return data;
	}

	private formatHttpError(error: unknown): string {
		const axiosError = error as AxiosError;
		const data = axiosError.response?.data;

		if (typeof data === 'string') return data;
		if (data) return JSON.stringify(data);

		return axiosError.message ?? 'Unknown error';
	}

	private async getWorkspaceInfo(accessToken: string): Promise<{ id: string; name: string }> {
		try {
			const linearClient = new LinearClient({ accessToken });
			const organization = await linearClient.organization;

			return { id: organization.id, name: organization.name };
		} catch (error) {
			this.logger.error(error);
			throw new BadRequestException('Failed to fetch workspace info');
		}
	}
}
