ALTER TABLE `shares` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `shares_user_id_kind_slug_idx` ON `shares` (`user_id`,`kind`,`slug`);