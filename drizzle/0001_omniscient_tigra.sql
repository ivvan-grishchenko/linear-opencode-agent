CREATE TABLE `agent_sessions` (
	`agent_session_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`error_message` text,
	`issue_id` text,
	`open_code_base_url` text NOT NULL,
	`open_code_session_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`repository_name` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repo_mappings` (
	`created_at` integer NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`repository_name` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `project_id`)
);
