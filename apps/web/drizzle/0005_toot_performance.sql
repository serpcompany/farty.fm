PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_toots` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`song_id` text,
	`created_at` integer NOT NULL,
	`seconds` real NOT NULL,
	`arrangement` text,
	`performance` text,
	`audio_bytes` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "toots_song_or_performance" CHECK((song_id is not null and arrangement is not null and performance is null)
        or (song_id is null and arrangement is null and performance is not null))
);
--> statement-breakpoint
-- Every Toot so far is a Toot of a Song: it has no Performance (#278). Edited by hand, since
-- drizzle-kit also copies `performance`, which the old table doesn't have.
INSERT INTO `__new_toots`("user_id", "id", "title", "song_id", "created_at", "seconds", "arrangement", "audio_bytes", "updated_at", "deleted_at") SELECT "user_id", "id", "title", "song_id", "created_at", "seconds", "arrangement", "audio_bytes", "updated_at", "deleted_at" FROM `toots`;--> statement-breakpoint
DROP TABLE `toots`;--> statement-breakpoint
ALTER TABLE `__new_toots` RENAME TO `toots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `toots_user_id_updated_at_idx` ON `toots` (`user_id`,`updated_at`);
