# Database Schema

This doc defines the first-pass `Cloudflare D1 + Drizzle` schema for Pedos.

Use it to guide:

- Drizzle schema files
- migration order
- API planning
- feature implementation for MVP and `Musical Fruit`

## Recommendation

Use one shared relational schema in `D1`.

Model the system in three layers:

- auth-owned tables from `Better Auth`
- app-owned user and recording tables
- `Musical Fruit` generation, job, and sharing tables

Keep raw audio files out of the database. Store only metadata and storage keys in `D1`.

## Design Principles

- use `TEXT` IDs across app tables so they match `Better Auth` string IDs cleanly
- keep the schema normalized; do not store clip ID arrays in one column
- use soft delete for user-facing content first
- keep stats derived from recording rows instead of creating a separate stats table in MVP
- treat generation jobs as operational records and generated songs as user-facing records

## Access Patterns To Optimize For

The first schema should optimize for these queries:

- fetch the current user
- fetch the current user's settings
- list recent recordings for a user
- open one saved recording for playback
- soft-delete one recording
- list generated songs for a user by newest first
- show songs by status: `in_progress`, `ready`, `failed`
- fetch the clips used for one generated song
- poll generation jobs by status
- resolve a share link by slug

## What Stays Out Of The Database

- raw fart audio blobs
- generated song audio blobs
- temporary recording files
- large AI request or response payloads unless a debug need is proven later

Those live in `R2`.

## ID And Timestamp Conventions

- primary keys: `TEXT`
- foreign keys: `TEXT`
- booleans in SQLite / D1: `INTEGER` with `0` or `1`
- timestamps: store UTC epoch milliseconds in `INTEGER`
- status values: store as `TEXT` and enforce through app constants and `CHECK` constraints where practical

## Table Plan

### 1. `user`

This is the primary auth identity table owned by `Better Auth`.

Expected minimum shape:

- `id` `TEXT` primary key
- `email` `TEXT` unique not null
- `email_verified` `INTEGER` not null default `0`
- `name` `TEXT` nullable
- `image` `TEXT` nullable
- `created_at` `INTEGER` not null
- `updated_at` `INTEGER` not null

Notes:

- use the exact Better Auth migration output for this table
- do not hand-design this table differently unless the auth integration requires it

### 2. `session`

This is the active-session table owned by `Better Auth`.

Expected minimum shape:

- `id` `TEXT` primary key
- `user_id` `TEXT` not null
- `token` `TEXT` unique not null
- `expires_at` `INTEGER` not null
- `created_at` `INTEGER` not null
- `updated_at` `INTEGER` not null

Constraints and indexes:

- foreign key `user_id -> user.id` on delete `CASCADE`
- index on `user_id`
- unique index on `token`

### 3. `account`

This stores linked auth providers such as Apple and later Google.

Expected minimum shape:

- `id` `TEXT` primary key
- `user_id` `TEXT` not null
- `provider_id` `TEXT` not null
- `account_id` `TEXT` not null
- provider token fields as required by Better Auth
- `created_at` `INTEGER` not null
- `updated_at` `INTEGER` not null

Constraints and indexes:

- foreign key `user_id -> user.id` on delete `CASCADE`
- unique composite index on `provider_id, account_id`
- index on `user_id`

### 4. `verification`

This covers verification and recovery flows owned by `Better Auth`.

Expected minimum shape:

- `id` `TEXT` primary key
- `identifier` `TEXT` not null
- `value` `TEXT` not null
- `expires_at` `INTEGER` not null
- `created_at` `INTEGER` not null

Notes:

- exact columns should follow Better Auth's generated schema

### 5. `user_preferences`

This is the app-owned extension table for settings that do not belong in auth.

Purpose:

- quick-record settings
- onboarding state
- later product preferences

Recommended columns:

- `user_id` `TEXT` primary key
- `onboarding_state` `TEXT` not null default `'new'`
- `auto_record_on_foreground_enabled` `INTEGER` not null default `0`
- `share_default_visibility` `TEXT` nullable
- `created_at` `INTEGER` not null
- `updated_at` `INTEGER` not null

Constraints and indexes:

- foreign key `user_id -> user.id` on delete `CASCADE`
- optional `CHECK` on `onboarding_state` when the state list is finalized

Why a separate table:

- keeps auth-owned data separate from product-owned settings
- avoids modifying Better Auth's main `user` shape for app-specific preferences

### 6. `recordings`

This is the core MVP content table for saved fart recordings.

Purpose:

- drive history
- drive playback
- power stats
- act as source material for `Musical Fruit`

Recommended columns:

- `id` `TEXT` primary key
- `user_id` `TEXT` not null
- `recording_source` `TEXT` not null
- `status` `TEXT` not null default `'ready'`
- `bucket` `TEXT` not null
- `object_key` `TEXT` not null
- `mime_type` `TEXT` not null
- `duration_ms` `INTEGER` not null
- `file_size_bytes` `INTEGER` nullable
- `recorded_at` `INTEGER` not null
- `note_text` `TEXT` nullable
- `intensity_tag` `TEXT` nullable
- `created_at` `INTEGER` not null
- `updated_at` `INTEGER` not null
- `deleted_at` `INTEGER` nullable

Recommended `recording_source` values:

- `manual`
- `siri`
- `auto_start`
- `floating_button`

Recommended `status` values:

- `uploading`
- `ready`
- `upload_failed`
- `deleted`

Constraints and indexes:

- foreign key `user_id -> user.id` on delete `CASCADE`
- unique index on `bucket, object_key`
- index on `user_id, recorded_at DESC`
- index on `user_id, status, recorded_at DESC`
- `CHECK (duration_ms >= 0)`
- `CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0)`

Notes:

- do not make `intensity_tag` a hard enum until product vocabulary is finalized
- keep deleted rows for history integrity and later cleanup handling

### 7. `generated_songs`

This is the user-facing record for a song submission and its result.

Purpose:

- create the visible `in progress` item immediately after submission
- keep the later ready or failed result in one place
- hold user-facing generation metadata

Recommended columns:

- `id` `TEXT` primary key
- `user_id` `TEXT` not null
- `song_mode` `TEXT` not null
- `source_mode` `TEXT` not null
- `status` `TEXT` not null default `'queued'`
- `system_title` `TEXT` nullable
- `custom_title` `TEXT` nullable
- `prompt_text` `TEXT` nullable
- `genre` `TEXT` nullable
- `lyrics_enabled` `INTEGER` not null default `0`
- `instruments_enabled` `INTEGER` not null default `0`
- `cover_artist_name` `TEXT` nullable
- `cover_song_name` `TEXT` nullable
- `result_bucket` `TEXT` nullable
- `result_object_key` `TEXT` nullable
- `duration_ms` `INTEGER` nullable
- `last_error_message` `TEXT` nullable
- `created_at` `INTEGER` not null
- `updated_at` `INTEGER` not null
- `submitted_at` `INTEGER` nullable
- `completed_at` `INTEGER` nullable
- `deleted_at` `INTEGER` nullable

Recommended `song_mode` values:

- `original`
- `cover_concept`

Recommended `source_mode` values:

- `all`
- `manual`
- `ai_smart_choose`

Recommended `status` values:

- `queued`
- `processing`
- `ready`
- `failed`
- `deleted`

Constraints and indexes:

- foreign key `user_id -> user.id` on delete `CASCADE`
- index on `user_id, created_at DESC`
- index on `user_id, status, created_at DESC`
- unique index on `result_bucket, result_object_key` if both are non-null

Why this is separate from `generation_jobs`:

- `generated_songs` is the thing the user sees
- `generation_jobs` is the operational execution record

### 8. `generated_song_sources`

This is the join table between generated songs and source recordings.

Purpose:

- keep the source relationship normalized
- support manual selection, `use all`, and `AI Smart Choose`
- let the app show which clips were used for a result

Recommended columns:

- `generated_song_id` `TEXT` not null
- `recording_id` `TEXT` not null
- `source_order` `INTEGER` nullable
- `created_at` `INTEGER` not null

Constraints and indexes:

- primary key on `generated_song_id, recording_id`
- foreign key `generated_song_id -> generated_songs.id` on delete `CASCADE`
- foreign key `recording_id -> recordings.id` on delete `RESTRICT`
- index on `recording_id`

Why `RESTRICT` on recording delete:

- a generated song should not lose source-history references if the raw recording row is still needed for context
- use soft delete on `recordings` first instead of physical row deletion

### 9. `generation_jobs`

This is the operational table for async generation work.

Purpose:

- queue and track provider jobs
- support retries
- support provider callback or polling state

Recommended columns:

- `id` `TEXT` primary key
- `generated_song_id` `TEXT` not null
- `provider` `TEXT` not null
- `provider_model` `TEXT` nullable
- `provider_job_id` `TEXT` nullable
- `status` `TEXT` not null default `'queued'`
- `attempt_number` `INTEGER` not null default `1`
- `request_snapshot_json` `TEXT` nullable
- `error_code` `TEXT` nullable
- `error_message` `TEXT` nullable
- `queued_at` `INTEGER` not null
- `started_at` `INTEGER` nullable
- `finished_at` `INTEGER` nullable
- `created_at` `INTEGER` not null
- `updated_at` `INTEGER` not null

Recommended `status` values:

- `queued`
- `submitted`
- `running`
- `succeeded`
- `failed`
- `canceled`
- `timed_out`

Constraints and indexes:

- foreign key `generated_song_id -> generated_songs.id` on delete `CASCADE`
- index on `status, queued_at`
- index on `generated_song_id, created_at DESC`
- unique index on `provider, provider_job_id` when `provider_job_id` is present

Notes:

- allow more than one job row per generated song so retries do not require a schema rewrite later
- the app should only allow one active job per song at a time

### 10. `song_shares`

This is the share-link table for generated songs.

Purpose:

- create stable share links
- support revocation
- avoid exposing raw storage URLs

Recommended columns:

- `id` `TEXT` primary key
- `generated_song_id` `TEXT` not null
- `created_by_user_id` `TEXT` not null
- `slug` `TEXT` not null
- `status` `TEXT` not null default `'active'`
- `visibility` `TEXT` not null default `'link'`
- `expires_at` `INTEGER` nullable
- `revoked_at` `INTEGER` nullable
- `created_at` `INTEGER` not null
- `updated_at` `INTEGER` not null

Recommended `status` values:

- `active`
- `revoked`
- `expired`

Constraints and indexes:

- foreign key `generated_song_id -> generated_songs.id` on delete `CASCADE`
- foreign key `created_by_user_id -> user.id` on delete `CASCADE`
- unique index on `slug`
- index on `generated_song_id`

## Relationships

- `user` 1:1 `user_preferences`
- `user` 1:many `session`
- `user` 1:many `account`
- `user` 1:many `recordings`
- `user` 1:many `generated_songs`
- `generated_songs` many:many `recordings` through `generated_song_sources`
- `generated_songs` 1:many `generation_jobs`
- `generated_songs` 1:many `song_shares`

## Soft Delete Vs Hard Delete

Recommended first-pass policy:

- `recordings`
  - soft delete metadata with `deleted_at`
  - mark `status = deleted`
  - do not hard-delete the row immediately
  - delay physical `R2` cleanup if the recording is referenced by a generated song
- `generated_songs`
  - soft delete metadata with `deleted_at`
  - revoke active shares
  - clean up result files through background cleanup later
- `song_shares`
  - revoke by status instead of hard delete
- `generation_jobs`
  - never hard-delete in normal product flows
  - keep for debugging and cost review

## Stats Strategy

Do not create a dedicated stats table in MVP.

Derive stats from `recordings`:

- total recording count
- total duration
- this week activity
- longest recording

Add cached aggregates later only if query cost becomes a real problem.

## Recommended Index Summary

Minimum important indexes:

- `session.user_id`
- `account.user_id`
- `account(provider_id, account_id)` unique
- `recordings(user_id, recorded_at DESC)`
- `recordings(user_id, status, recorded_at DESC)`
- `generated_songs(user_id, created_at DESC)`
- `generated_songs(user_id, status, created_at DESC)`
- `generated_song_sources.recording_id`
- `generation_jobs(status, queued_at)`
- `generation_jobs(generated_song_id, created_at DESC)`
- `song_shares.slug` unique

## Migration Order

Recommended order:

1. Better Auth base tables
2. `user_preferences`
3. `recordings`
4. `generated_songs`
5. `generated_song_sources`
6. `generation_jobs`
7. `song_shares`

Why:

- auth identity lands first
- MVP recording schema lands before `Musical Fruit`
- async generation and sharing land after the core song record exists

## Drizzle Implementation Notes

- keep Better Auth tables and app tables in the same Drizzle migration flow
- prefer schema constants for all status values
- use app-level helper functions to compute an effective display title from:
  - `custom_title`
  - then `system_title`
  - then a generated fallback
- keep `R2` object keys deterministic, for example:
  - `users/{userId}/recordings/{recordingId}`
  - `users/{userId}/generated-songs/{generatedSongId}`

## Open Decisions

- whether day-one auth is required or guest mode ships first
- whether `intensity_tag` becomes a constrained enum in MVP or remains free text
- whether generated-song retries reuse one `generated_songs` row or create a new visible result item
- whether share links can expire in the first version or are only revoked manually

## Related Docs

- [Services](./services/README.md)
- [Auth And Account](./services/auth-and-account.md)
- [Data And Storage](./services/data-and-storage.md)
- [Quick Record](./features/quick-record.md)
- [Musical Fruit](./features/musical-fruit/README.md)
- [Original Song Generation](./features/musical-fruit/original-song-generation.md)
- [Generated Song Sharing](./features/musical-fruit/generated-song-sharing.md)

## Sources

- Cloudflare D1:
  https://developers.cloudflare.com/d1/
- Better Auth database docs:
  https://www.better-auth.com/docs/concepts/database
- Better Auth SQLite adapter:
  https://better-auth.com/docs/adapters/sqlite
