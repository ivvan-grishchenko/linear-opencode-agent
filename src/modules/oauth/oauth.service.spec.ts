import type { DatabaseClient } from '@modules/database';
import type { ChainMock } from 'chain-mock';
import type { Request } from 'express';

import { AppConfig } from '@config/app.config';
import { LinearConfig } from '@config/linear.config';
import { oauthTokens } from '@db/schema';
import { LinearClient } from '@linear/sdk';
import { DatabaseInject } from '@modules/database';
import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { TestBed } from '@suites/unit';
import { chainMock } from 'chain-mock';
import { addSeconds, subMilliseconds } from 'date-fns';
import ms from 'ms';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OauthService } from './oauth.service';

vi.mock('@linear/sdk', () => ({
	// oxlint-disable-next-line vitest/prefer-mock-return-shorthand
	LinearClient: vi.fn().mockImplementation(function LinearClient(this: Record<string, unknown>) {
		this.organization = Promise.resolve({ id: 'org-1', name: 'Test Org' });
	}),
}));

describe('oauthService', () => {
	let service: OauthService;
	let db: ChainMock<DatabaseClient>;
	let httpService: HttpService;

	beforeEach(async () => {
		db = chainMock<DatabaseClient>();

		const { unit, unitRef } = await TestBed.solitary(OauthService)
			.mock(AppConfig.KEY)
			.final({ appUrl: 'https://app.example.com' })
			.mock(LinearConfig.KEY)
			.final({ clientId: 'client-id', clientSecret: 'client-secret' })
			.mock(DatabaseInject.CLIENT)
			.impl(() => db)
			.compile();

		service = unit;
		httpService = unitRef.get(HttpService);
	});

	afterEach(() => vi.restoreAllMocks());

	describe('getOauthAuthorizeRedirectUrl', () => {
		it('should construct URL without state parameter', () => {
			const request = { url: '/oauth/authorize' } as Request;

			const result = service.getOauthAuthorizeRedirectUrl(request);

			const url = new URL(result);
			expect(url.origin).toBe('https://linear.app');
			expect(url.pathname).toBe('/oauth/authorize');
			expect(url.searchParams.get('client_id')).toBe('client-id');
			expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/oauth/callback');
			expect(url.searchParams.get('response_type')).toBe('code');
			expect(url.searchParams.get('scope')).toBe('read,write,app:assignable,app:mentionable');
			expect(url.searchParams.get('actor')).toBe('app');
			expect(url.searchParams.has('state')).toBeFalsy();
		});

		it('should include state parameter when present in request', () => {
			const request = { url: '/oauth/authorize?state=my-state' } as Request;

			const result = service.getOauthAuthorizeRedirectUrl(request);

			const url = new URL(result);
			expect(url.searchParams.get('state')).toBe('my-state');
		});

		it('should ignore empty state parameter', () => {
			const request = { url: '/oauth/authorize?state=' } as Request;

			const result = service.getOauthAuthorizeRedirectUrl(request);

			const url = new URL(result);
			expect(url.searchParams.has('state')).toBeFalsy();
		});
	});

	describe('handleOauthCallback', () => {
		it('should throw BadRequestException when error parameter is present', async () => {
			const request = { url: '/oauth/callback?error=access_denied' } as Request;

			await expect(service.handleOauthCallback(request)).rejects.toThrow(BadRequestException);
		});

		it('should throw BadRequestException when code is missing', async () => {
			const request = { url: '/oauth/callback' } as Request;

			await expect(service.handleOauthCallback(request)).rejects.toThrow(BadRequestException);
		});

		it('should exchange code and save token successfully', async () => {
			const request = { url: '/oauth/callback?code=auth-code-123' } as Request;

			const tokenData = {
				access_token: 'new-access-token',
				expires_in: 3_600,
				refresh_token: 'new-refresh-token',
			};

			vi.mocked(httpService.post).mockReturnValue(of({ data: tokenData } as any));

			const result = await service.handleOauthCallback(request);

			expect(result).toStrictEqual({ workspaceId: 'org-1', workspaceName: 'Test Org' });
			expect(db.insert.values).toHaveBeenChainCalledWith(
				[oauthTokens],
				[
					expect.objectContaining({
						accessToken: tokenData.access_token,
						refreshToken: tokenData.refresh_token,
						workspaceId: 'org-1',
						workspaceName: 'Test Org',
					}),
				]
			);
		});

		it('should handle token exchange failure', async () => {
			const request = { url: '/oauth/callback?code=bad-code' } as Request;

			vi.mocked(httpService.post).mockReturnValue(throwError(() => new Error('Network error')));

			await expect(service.handleOauthCallback(request)).rejects.toThrow(BadRequestException);
		});

		it('should handle sync error during token exchange', async () => {
			const request = { url: '/oauth/callback?code=auth-code-123' } as Request;

			vi.mocked(httpService.post).mockImplementation(() => {
				throw new Error('Sync error');
			});

			await expect(service.handleOauthCallback(request)).rejects.toThrow(BadRequestException);
		});

		it('should handle HTTP error with string response body', async () => {
			const request = { url: '/oauth/callback?code=bad-code' } as Request;

			vi.mocked(httpService.post).mockReturnValue(
				throwError(() => ({
					message: 'Request failed',
					response: { data: 'invalid_grant' },
				}))
			);

			await expect(service.handleOauthCallback(request)).rejects.toThrow(BadRequestException);
		});

		it('should handle HTTP error with object response body', async () => {
			const request = { url: '/oauth/callback?code=bad-code' } as Request;

			vi.mocked(httpService.post).mockReturnValue(
				throwError(() => ({
					message: 'Request failed',
					response: { data: { error: 'invalid_grant' } },
				}))
			);

			await expect(service.handleOauthCallback(request)).rejects.toThrow(BadRequestException);
		});

		it('should handle HTTP error without response or message', async () => {
			const request = { url: '/oauth/callback?code=bad-code' } as Request;

			vi.mocked(httpService.post).mockReturnValue(throwError(() => ({})));

			await expect(service.handleOauthCallback(request)).rejects.toThrow(BadRequestException);
		});

		it('should handle workspace info fetch failure', async () => {
			const request = { url: '/oauth/callback?code=auth-code-123' } as Request;

			const tokenData = {
				access_token: 'new-access-token',
				expires_in: 3_600,
				refresh_token: 'new-refresh-token',
			};

			vi.mocked(httpService.post).mockReturnValue(of({ data: tokenData } as any));

			// oxlint-disable-next-line vitest/prefer-mock-return-shorthand
			vi.mocked(LinearClient).mockImplementation(function LinearClient(this: any) {
				this.organization = Promise.reject(new Error('API error'));
			});

			await expect(service.handleOauthCallback(request)).rejects.toThrow(BadRequestException);
		});
	});

	describe('getAccessToken', () => {
		it('should return null when no token found', async () => {
			db.select.from.where.mockResolvedValue([]);

			const result = await service.getAccessToken('workspace-1');

			expect(result).toBeNull();
		});

		it('should return token when not expired', async () => {
			const futureTime = addSeconds(Date.now(), 3_600).getTime();

			db.select.from.where.mockResolvedValue([
				{
					accessToken: 'valid-token',
					expiresAt: futureTime,
					refreshToken: 'refresh-token',
				},
			]);

			const result = await service.getAccessToken('workspace-1');

			expect(result).toBe('valid-token');
		});

		it('should refresh token when expired and refresh succeeds', async () => {
			const pastTime = subMilliseconds(Date.now(), ms('10m')).getTime();

			db.select.from.where.mockResolvedValue([
				{
					accessToken: 'expired-token',
					expiresAt: pastTime,
					refreshToken: 'refresh-token',
				},
			]);

			const refreshedToken = {
				access_token: 'refreshed-token',
				expires_in: 3_600,
				refresh_token: 'new-refresh-token',
			};

			vi.mocked(httpService.post).mockReturnValue(of({ data: refreshedToken } as any));

			const result = await service.getAccessToken('workspace-1');

			expect(result).toBe('refreshed-token');
			expect(db.update.set).toHaveBeenChainCalledWith(
				[oauthTokens],
				[
					expect.objectContaining({
						accessToken: refreshedToken.access_token,
						refreshToken: refreshedToken.refresh_token,
					}),
				]
			);
		});

		it('should return null when token expired and refresh fails', async () => {
			const pastTime = subMilliseconds(Date.now(), ms('10m')).getTime();

			db.select.from.where.mockResolvedValue([
				{
					accessToken: 'expired-token',
					expiresAt: pastTime,
					refreshToken: 'refresh-token',
				},
			]);

			vi.mocked(httpService.post).mockReturnValue(throwError(() => new Error('Refresh failed')));

			const result = await service.getAccessToken('workspace-1');

			expect(result).toBeNull();
		});

		it('should return null when token expired and no refresh token', async () => {
			const pastTime = subMilliseconds(Date.now(), ms('10m')).getTime();

			db.select.from.where.mockResolvedValue([
				{
					accessToken: 'expired-token',
					expiresAt: pastTime,
					refreshToken: null,
				},
			]);

			const result = await service.getAccessToken('workspace-1');

			expect(result).toBeNull();
		});
	});
});
