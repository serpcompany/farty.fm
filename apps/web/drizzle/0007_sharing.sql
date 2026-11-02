CREATE TABLE `handles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handles_handle_unique` ON `handles` (`handle`);--> statement-breakpoint
CREATE TABLE `share_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `share_reports_created_at_idx` ON `share_reports` (`created_at`);--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`taken_down_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_user_id_kind_item_id_idx` ON `shares` (`user_id`,`kind`,`item_id`);