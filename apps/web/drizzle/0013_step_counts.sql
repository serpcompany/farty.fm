CREATE TABLE `step_counts` (
	`day` text NOT NULL,
	`step` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`day`, `step`)
);
