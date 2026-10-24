CREATE TABLE `toot_payments` (
	`user_id` text NOT NULL,
	`toot_id` text NOT NULL,
	`checkout_session_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	PRIMARY KEY(`user_id`, `toot_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
