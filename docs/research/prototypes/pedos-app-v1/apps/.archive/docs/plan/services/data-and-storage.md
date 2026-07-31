# Data And Storage

This doc defines the recommended database and file-storage approach for:

- iPhone MVP
- later Android support
- future `Pedos AI` generation data

## Recommendation

Use a shared backend data layer:

- ORM and migrations: `Drizzle`
- metadata database: `Cloudflare D1`
- file storage: `Cloudflare R2`

Do not use CloudKit as the main system of record if Android is planned.

## Why

This product has a clear mix of:

- user accounts
- recording metadata
- recorded audio files
- generated song metadata
- generated song files
- shareable song links
- generation job tracking

That is a better fit for:

- typed schema and migrations through Drizzle
- relational metadata in a SQL database
- file assets in object storage

than for an Apple-only backend strategy.

## What Goes In The Database

The database should hold metadata, not the raw audio blobs.

Use `Drizzle` as the schema and migration layer for both app tables and Better Auth tables.

Core records:

- users
- recordings
- generated songs
- generation jobs
- song shares

Likely recording fields:

- recording ID
- user ID
- created at
- duration
- storage path
- deleted at if soft delete is used

Likely generated-song fields:

- generated song ID
- user ID
- title / custom name
- source mode
- source clip IDs
- generation status
- lyrics enabled
- instruments enabled
- genre
- storage path

Likely share fields:

- share ID
- generated song ID
- link token or slug
- created at
- status

## What Goes In File Storage

Use storage buckets for:

- raw recorded fart clips
- generated song audio files
- optional derived share assets later

Recommended shape:

- private recordings bucket
- private generated songs bucket
- separate shared-song handling if public links are introduced later

## Local Device Storage

The app should still use local device storage for:

- temporary recording state
- upload staging
- local playback cache

But local storage should not be the long-term system of record.

## CloudKit Position

CloudKit is not the recommended primary data layer for this roadmap.

Reason:

- it is too Apple-specific for a product expected to expand to Android
- it increases migration work later

## Dependencies

- [Database Schema](./../database-schema.md)
- [Cross-Platform Stack](./cross-platform-stack.md)
- [Auth And Account](./auth-and-account.md)
- [Services](./README.md)
- [Musical Fruit](./../features/musical-fruit/README.md)

## Sources

- Cloudflare D1:
  https://developers.cloudflare.com/d1/
- Cloudflare R2:
  https://developers.cloudflare.com/r2/
- Better Auth database docs:
  https://www.better-auth.com/docs/concepts/database
- Better Auth SQLite adapter:
  https://better-auth.com/docs/adapters/sqlite
- CloudKit:
  https://developer.apple.com/documentation/cloudkitjs/cloudkit
