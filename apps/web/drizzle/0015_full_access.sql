CREATE TABLE `full_access` (
	`user_id` text PRIMARY KEY NOT NULL,
	`checkout_session_id` text NOT NULL,
	`payment_intent` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	`refunded_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `toot_payments` ADD `refunded_at` integer;