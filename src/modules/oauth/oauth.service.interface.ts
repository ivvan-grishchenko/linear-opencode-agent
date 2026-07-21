import type { Request } from 'express';

export interface IOauthService {
	getOauthAuthorizeRedirectUrl(request: Request): string;
	handleOauthCallback(request: Request): Promise<{ workspaceId: string; workspaceName: string }>;
	getAccessToken(workspaceId: string): Promise<string | null>;
}
