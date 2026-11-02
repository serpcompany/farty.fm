CREATE TABLE `favorite_songs` (
	`user_id` text NOT NULL,
	`song_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	PRIMARY KEY(`user_id`, `song_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `favorite_songs_user_id_updated_at_idx` ON `favorite_songs` (`user_id`,`updated_at`);