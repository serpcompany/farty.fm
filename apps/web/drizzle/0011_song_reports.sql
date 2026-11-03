CREATE TABLE `song_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`song_version` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `song_reports_created_at_idx` ON `song_reports` (`created_at`);--> statement-breakpoint
CREATE INDEX `song_reports_song_id_idx` ON `song_reports` (`song_id`);