import type { Mocked } from '@suites/unit';
import type { Request, Response } from 'express';

import { HttpStatus } from '@nestjs/common';
import { TestBed } from '@suites/unit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IOauthService } from './oauth.service.interface';

import { OauthController } from './oauth.controller';
import { OauthInject } from './oauth.enum';

describe('oauthController', () => {
	let controller: OauthController;
	let service: Mocked<IOauthService>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(OauthController).compile();

		controller = unit;
		service = unitRef.get(OauthInject.SERVICE);
	});

	describe('authorize', () => {
		const request: Mocked<Request> = {} as Mocked<Request>;
		const response: Mocked<Response> = { redirect: vi.fn() } as Mocked<Response>;

		it('should throw an error when service throws', () => {
			service.getOauthAuthorizeRedirectUrl.mockThrow('Error');

			let caughtError;

			try {
				controller.authorize(request, response);
			} catch (error) {
				caughtError = error;
			}

			expect(caughtError).toBeDefined();
			expect(response.redirect).not.toHaveBeenCalled();
		});

		it('should redirect when service returns url', () => {
			const redirectUrl = 'https://example.com';
			service.getOauthAuthorizeRedirectUrl.mockReturnValue(redirectUrl);

			controller.authorize(request, response);

			expect(service.getOauthAuthorizeRedirectUrl).toHaveBeenCalledWith(request);
			expect(response.redirect).toHaveBeenCalledWith(HttpStatus.FOUND, redirectUrl);
		});
	});

	describe('callback', () => {
		let request: Mocked<Request>;
		let response: Mocked<Response>;

		beforeEach(() => {
			request = {} as Mocked<Request>;
			response = {
				send: vi.fn(),
				status: vi.fn().mockReturnThis(),
			} as unknown as Mocked<Response>;
		});

		it('should send HTML with workspace info', async () => {
			const workspaceId = 'workspace-123';
			const workspaceName = 'My Workspace';
			await service.handleOauthCallback.mockResolvedValue({ workspaceId, workspaceName });

			await controller.callback(request, response);

			expect(service.handleOauthCallback).toHaveBeenCalledWith(request);
			expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
			expect(response.send).toHaveBeenCalledWith(
				expect.stringContaining(`<strong>${workspaceName}</strong>`)
			);
			expect(response.send).toHaveBeenCalledWith(
				expect.stringContaining(`<code>${workspaceId}</code>`)
			);
		});

		it('should escape HTML special characters in workspace name', async () => {
			const workspaceId = 'ws-1';
			const workspaceName = '<script>alert("xss")</script>';
			await service.handleOauthCallback.mockResolvedValue({ workspaceId, workspaceName });

			await controller.callback(request, response);

			const html = response.send.mock.calls[0][0] as string;
			expect(html).not.toContain('<script>');
			expect(html).toContain('&lt;script&gt;');
			expect(html).toContain('&quot;');
		});

		it('should escape HTML special characters in workspace ID', async () => {
			const workspaceId = '<img src=x onerror=alert(1)>';
			const workspaceName = 'Workspace';
			await service.handleOauthCallback.mockResolvedValue({ workspaceId, workspaceName });

			await controller.callback(request, response);

			const html = response.send.mock.calls[0][0] as string;
			expect(html).not.toContain('<img');
			expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		});

		it('should escape ampersand and single quote', async () => {
			const workspaceId = 'id&1';
			const workspaceName = "name's";
			await service.handleOauthCallback.mockResolvedValue({ workspaceId, workspaceName });

			await controller.callback(request, response);

			const html = response.send.mock.calls[0][0] as string;
			expect(html).toContain('&amp;');
			expect(html).toContain('&#39;');
		});

		it('should propagate errors from service', async () => {
			await service.handleOauthCallback.mockRejectedValue(new Error('Something failed'));

			await expect(controller.callback(request, response)).rejects.toThrow('Something failed');
		});
	});
});
