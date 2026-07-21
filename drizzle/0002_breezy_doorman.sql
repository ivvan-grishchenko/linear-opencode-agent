PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_sessions` (
	`agent_session_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`error_message` text,
	`issue_id` text,
	`open_code_base_url` text,
	`open_code_session_id` text,
	`organization_id` text NOT NULL,
	`repository_name` text,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_agent_sessions`("agent_session_id", "created_at", "error_message", "issue_id", "open_code_base_url", "open_code_session_id", "organization_id", "repository_name", "status", "updated_at") SELECT "agent_session_id", "created_at", "error_message", "issue_id", "open_code_base_url", "open_code_session_id", "organization_id", "repository_name", "status", "updated_at" FROM `agent_sessions`;--> statement-breakpoint
DROP TABLE `agent_sessions`;--> statement-breakpoint
ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;