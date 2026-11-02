CREATE TABLE `friend_requests` (
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`from_user_id`, `to_user_id`),
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "friend_requests_not_self" CHECK(from_user_id <> to_user_id)
);
--> statement-breakpoint
CREATE INDEX `friend_requests_to_user_id_idx` ON `friend_requests` (`to_user_id`);--> statement-breakpoint
CREATE TABLE `friends` (
	`user_id` text NOT NULL,
	`friend_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `friend_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`friend_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "friends_not_self" CHECK(user_id <> friend_id)
);
--> statement-breakpoint
CREATE INDEX `friends_friend_id_idx` ON `friends` (`friend_id`);--> statement-breakpoint
CREATE TABLE `profile_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_reports_created_at_idx` ON `profile_reports` (`created_at`);