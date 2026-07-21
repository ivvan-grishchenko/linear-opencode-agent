import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const oauthTokens = sqliteTable('oauth_tokens', {
	accessToken: text('access_token').notNull(),
	expiresAt: integer('expires_at').notNull(),
	refreshToken: text('refresh_token').notNull(),
	updatedAt: integer('updated_at').notNull(),
	workspaceId: text('workspace_id').primaryKey(),
	workspaceName: text('workspace_name').notNull(),
});

const repoMappings = sqliteTable(
	'repo_mappings',
	{
		createdAt: integer('created_at').notNull(),
		organizationId: text('organization_id').notNull(),
		projectId: text('project_id').notNull(),
		repositoryName: text('repository_name').notNull(),
		updatedAt: integer('updated_at').notNull(),
	},
	(table) => [primaryKey({ columns: [table.organizationId, table.projectId] })]
);

const agentSessions = sqliteTable('agent_sessions', {
	agentSessionId: text('agent_session_id').primaryKey(),
	createdAt: integer('created_at').notNull(),
	errorMessage: text('error_message'),
	issueId: text('issue_id'),
	mode: text('mode').notNull().$type<'delegation' | 'mention'>().default('mention'),
	openCodeBaseUrl: text('open_code_base_url'),
	openCodeSessionId: text('open_code_session_id'),
	organizationId: text('organization_id').notNull(),
	repositoryName: text('repository_name'),
	status: text('status').notNull().$type<'queued' | 'processing' | 'completed' | 'failed'>(),
	updatedAt: integer('updated_at').notNull(),
});

export { agentSessions, oauthTokens, repoMappings };
