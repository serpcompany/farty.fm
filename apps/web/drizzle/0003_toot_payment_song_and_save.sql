ALTER TABLE `toot_payments` ADD `song_id` text;--> statement-breakpoint
ALTER TABLE `toot_payments` ADD `saved_at` integer;--> statement-breakpoint
-- A paid Toot already saved, live or deleted, has used its payment (#213).
UPDATE `toot_payments` SET `saved_at` = `paid_at`, `song_id` = (
	SELECT `toots`.`song_id` FROM `toots`
	WHERE `toots`.`user_id` = `toot_payments`.`user_id` AND `toots`.`id` = `toot_payments`.`toot_id`
)
WHERE `paid_at` IS NOT NULL AND EXISTS (
	SELECT 1 FROM `toots`
	WHERE `toots`.`user_id` = `toot_payments`.`user_id` AND `toots`.`id` = `toot_payments`.`toot_id`
);
