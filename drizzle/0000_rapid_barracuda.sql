CREATE TABLE `oauth_tokens` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`workspace_name` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
