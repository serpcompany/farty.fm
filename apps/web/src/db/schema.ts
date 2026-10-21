import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { Analysis } from '../lib/recordings'
import type { TootArrangement } from '../lib/toot'

// The D1 schema (SERP's data-and-storage standard): Drizzle owns every table, Better Auth's too, so
// each change is a reviewed migration in `drizzle/` (`pnpm db:generate`). Columns are snake_case.
// Times are epoch milliseconds, read as `Date`.

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })
const flag = (name: string) => integer(name, { mode: 'boolean' })

// Better Auth's tables, as its `drizzleAdapter(db, { provider: 'sqlite' })` finds them: each export
// is named after its model, and each property after Better Auth's field. Better Auth writes every
// `created_at` and `updated_at` itself, so they have no defaults. Deleting a user deletes their
// sessions, sign-in methods, Recordings and Toots.

/** A person with an account. A first sign-in with an email code creates one. */
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  /** Better Auth requires it; sign-in by email code leaves it empty. */
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: flag('email_verified').notNull().default(false),
  image: text('image'),
  /** Pedos news by email: on unless they turn it off (the owner's decision, #150). */
  marketingEmail: flag('marketing_email').notNull().default(true),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
})

/** Signed-in browsers. Read from here on every request (no cookie cache), so deleting signs out. */
export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull()
  },
  table => [index('session_user_id_idx').on(table.userId)]
)

/** A user's sign-in methods. Email codes create none, but Better Auth's schema needs the table. */
export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull()
  },
  table => [index('account_user_id_idx').on(table.userId)]
)

/**
 * Sign-in codes waiting to be used, keyed by email. Better Auth's emailOTP plugin stores the code
 * as plain text by default (`storeOTP: 'plain'`), so #152 must set `storeOTP` to hash it, as
 * serp.app does.
 */
export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull()
  },
  table => [index('verification_identifier_idx').on(table.identifier)]
)

/**
 * Rate-limit counters, kept in D1 because each Worker isolate has its own memory: Better Auth's
 * and sign-in's own (`consumeSlot` in `src/server/auth-config.ts`). Each `key` is a label and an
 * HMAC, never an email or IP address, and `last_request` is when the row's window ends, in epoch
 * milliseconds.
 */
export const rateLimit = sqliteTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull()
})

// A user's Recordings and Toots, as the browser keeps them (`src/lib/recordings.ts`,
// `src/lib/toot.ts`), keyed by the user and the id the browser gave them. Their audio is in R2
// (`MEDIA`) under `users/{user_id}/recordings/{id}.wav` and `users/{user_id}/toots/{id}.wav`.
// `updated_at` is when the server last changed the row, for `GET /api/library?since=`. A delete
// keeps the row as a tombstone, with `deleted_at` set, so other browsers delete their copy too.

/** A saved fart clip. It uploads once its analysis is done. */
export const recordings = sqliteTable(
  'recordings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    /** Named "Recording {number}". */
    number: integer('number').notNull(),
    createdAt: timestamp('created_at').notNull(),
    /** The whole file's length. */
    seconds: real('seconds').notNull(),
    sampleRate: integer('sample_rate').notNull(),
    /** Loudness bars, each 0…1. */
    waveform: text('waveform', { mode: 'json' }).$type<number[]>().notNull(),
    /** What Recording Analysis found; null when the Recording couldn't be analyzed. */
    analysis: text('analysis', { mode: 'json' }).$type<Analysis>(),
    /** The WAV's size in R2. */
    audioBytes: integer('audio_bytes').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    deletedAt: timestamp('deleted_at')
  },
  table => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('recordings_user_id_updated_at_idx').on(table.userId, table.updatedAt)
  ]
)

/** A Song played by the user's Recordings, with its own rendered audio. */
export const toots = sqliteTable(
  'toots',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    /** The Song's title until the user renames it. */
    title: text('title').notNull(),
    songId: text('song_id').notNull(),
    createdAt: timestamp('created_at').notNull(),
    seconds: real('seconds').notNull(),
    /** Which Recording plays each of the Song's pitches, and the transposition. */
    arrangement: text('arrangement', { mode: 'json' }).$type<TootArrangement>().notNull(),
    /** The WAV's size in R2. */
    audioBytes: integer('audio_bytes').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    deletedAt: timestamp('deleted_at')
  },
  table => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('toots_user_id_updated_at_idx').on(table.userId, table.updatedAt)
  ]
)
