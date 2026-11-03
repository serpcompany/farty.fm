import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import type { FartChoices } from '../lib/engine/fart-choices'
import type { Performance } from '../lib/performance'
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
// sessions, sign-in methods, Recordings, Toots, Favorite Songs, Fart Choices, Toot payments,
// Handles, shares, friend requests either way, friendships and reports of their profile page.

/** A person with an account. A first sign-in with an email code creates one. */
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  /** Better Auth requires it; sign-in by email code leaves it empty. */
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: flag('email_verified').notNull().default(false),
  image: text('image'),
  /** Farty news by email: on unless they turn it off (the owner's decision, #150). */
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
 * Sign-in codes waiting to be used, keyed by email. Each code is kept only as an HMAC under
 * `BETTER_AUTH_SECRET` (`storeOTP` in `src/server/auth-config.ts`), never as the code itself.
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
 * and sign-in's own (`consumeSlot` in `src/server/auth-config.ts`), and Report's
 * (`REPORT_LIMITS`). Each `key` is a label and an HMAC, or a shared item's account and item ids,
 * never an email or IP address, and `last_request` is when the row's window ends, in epoch
 * milliseconds. Every spend first deletes the rows whose window has ended, through the index on
 * `last_request`, so it never reads the live rows.
 */
export const rateLimit = sqliteTable(
  'rate_limit',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    count: integer('count').notNull(),
    lastRequest: integer('last_request').notNull()
  },
  table => [index('rate_limit_last_request_idx').on(table.lastRequest)]
)

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
    /** Named "Recording {number}" until the user gives it a `name`. */
    number: integer('number').notNull(),
    createdAt: timestamp('created_at').notNull(),
    /** The whole file's length. */
    seconds: real('seconds').notNull(),
    sampleRate: integer('sample_rate').notNull(),
    /** Loudness bars, each 0…1. */
    waveform: text('waveform', { mode: 'json' }).$type<number[]>().notNull(),
    /** What Recording Analysis found; null when the Recording couldn't be analyzed. */
    analysis: text('analysis', { mode: 'json' }).$type<Analysis>(),
    /**
     * The Placed Pitch: the MIDI note the user placed a Recording on by ear, -1 (`NO_NOTE`) when
     * they left it out of Songs, or null when it follows its analysis (ADR 0015). Apart from
     * `analysis`, which keeps the upload's, so it changes alone (`PATCH /api/recordings/{id}/`)
     * and survives each browser's re-analysis.
     */
    placedPitch: integer('placed_pitch'),
    /**
     * The Trim: the part of the whole take the user kept with the handles, from and to these
     * seconds, and the fart found between them, which Songs play; all four null when untrimmed
     * (ADR 0019). The WAV never changes. Like `placedPitch`, it changes alone and survives each
     * browser's re-analysis.
     */
    trimStartSeconds: real('trim_start_seconds'),
    trimEndSeconds: real('trim_end_seconds'),
    trimFartStartSeconds: real('trim_fart_start_seconds'),
    trimFartEndSeconds: real('trim_fart_end_seconds'),
    /**
     * The name the user gave the Recording, or null for "Recording {number}" (#314). Like
     * `placedPitch`, it changes alone.
     */
    name: text('name'),
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

/**
 * A Song, or a Sound Pad Performance, played by the user's Recordings, with its own rendered audio.
 * A Toot of a Song has its Song and Arrangement; a Sound Pad Toot has neither, and its
 * Performance instead (ADR 0017).
 */
export const toots = sqliteTable(
  'toots',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    /** The Song's title, or "Sound Pad", until the user renames it. */
    title: text('title').notNull(),
    /** The catalog Song it plays. Null for a Sound Pad Toot. */
    songId: text('song_id'),
    createdAt: timestamp('created_at').notNull(),
    seconds: real('seconds').notNull(),
    /** Which Recording plays each of the Song's pitches, and the transposition. */
    arrangement: text('arrangement', { mode: 'json' }).$type<TootArrangement>(),
    /** What a Sound Pad Toot played: which Recording each tap played, and when. */
    performance: text('performance', { mode: 'json' }).$type<Performance>(),
    /** The WAV's size in R2. */
    audioBytes: integer('audio_bytes').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    deletedAt: timestamp('deleted_at')
  },
  table => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('toots_user_id_updated_at_idx').on(table.userId, table.updatedAt),
    // Unqualified, so the check reads the same once the migration renames its table.
    check(
      'toots_song_or_performance',
      sql`(song_id is not null and arrangement is not null and performance is null)
        or (song_id is null and arrangement is null and performance is not null)`
    )
  ]
)

/**
 * A Favorite Song: a catalog Song the user marked in Compose (#313), by the Song's id, which stays
 * with the account and no catalog row. Taking it off leaves a tombstone (`deleted_at`), as a
 * deleted Recording does, so another browser's read since then takes it off there too, and
 * favoriting it again clears the tombstone.
 */
export const favoriteSongs = sqliteTable(
  'favorite_songs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    songId: text('song_id').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    deletedAt: timestamp('deleted_at')
  },
  table => [
    primaryKey({ columns: [table.userId, table.songId] }),
    index('favorite_songs_user_id_updated_at_idx').on(table.userId, table.updatedAt)
  ]
)

/**
 * A Song's Fart Choices (#360): the farts the user swapped in for its pitches and left out of it
 * in Song Creator, by the catalog Song's id, as JSON (`FartChoices` in `engine/fart-choices.ts`).
 * Making the Song automatic again leaves a tombstone (`deleted_at`), as taking a Favorite Song off
 * does, so another browser's read since then drops its Choices too.
 */
export const fartChoices = sqliteTable(
  'fart_choices',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    songId: text('song_id').notNull(),
    choices: text('choices', { mode: 'json' }).$type<FartChoices>(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    deletedAt: timestamp('deleted_at')
  },
  table => [
    primaryKey({ columns: [table.userId, table.songId] }),
    index('fart_choices_user_id_updated_at_idx').on(table.userId, table.updatedAt)
  ]
)

/**
 * A Toot's payment (ADR 0010): one row per Toot a user has started to pay for, keyed by the user
 * and the Toot's id, made before its Toot is saved. `paid_at` is set once Stripe says it's paid
 * (the webhook, or the return from Checkout asking Stripe), and only then does the Toot upload.
 * `saved_at` is set with the Toot's first save, which uses the payment up: a Toot deleted since
 * can't be saved again, even once its tombstone is gone. Stripe keeps the payment itself; no card
 * data is here.
 */
export const tootPayments = sqliteTable(
  'toot_payments',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tootId: text('toot_id').notNull(),
    /** The latest Checkout Session for it: `cs_test_…` from Stripe, `dev_…` on a local run. */
    checkoutSessionId: text('checkout_session_id').notNull(),
    /** What the session charges, in the currency's smallest unit. */
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    /**
     * The Song it's a Toot of, so a paid Toot whose save never came back can be made and saved
     * again. Null for a payment started before #213.
     */
    songId: text('song_id'),
    createdAt: timestamp('created_at').notNull(),
    paidAt: timestamp('paid_at'),
    savedAt: timestamp('saved_at')
  },
  table => [primaryKey({ columns: [table.userId, table.tootId] })]
)

// Sharing (ADR 0020): nothing is public until its owner shares it. A shared item's page and audio
// are found by joining `shares` to the owner's Handle and to the live item, so Stop sharing,
// deleting the item or deleting the account takes the link down.

/**
 * A user's Handle: the name in their links, `farty.fm/u/<handle>/…`, picked the first time they
 * share. Lowercase, unique and checked against a block list (`src/lib/handle.ts`).
 */
export const handles = sqliteTable('handles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull().unique(),
  createdAt: timestamp('created_at').notNull()
})

/**
 * A shared item: one row while its owner shares it, keyed by a random id that is the link's
 * (`/u/<handle>/r/<id>/`). Stop sharing and deleting the item delete the row, so sharing again
 * makes a new link. `taken_down_at` is set by Farty after a report (docs/agents/web.md), and keeps
 * the row, so the item can't be shared again.
 */
export const shares = sqliteTable(
  'shares',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['recordings', 'toots'] }).notNull(),
    itemId: text('item_id').notNull(),
    createdAt: timestamp('created_at').notNull(),
    takenDownAt: timestamp('taken_down_at')
  },
  table => [
    uniqueIndex('shares_user_id_kind_item_id_idx').on(table.userId, table.kind, table.itemId)
  ]
)

/**
 * A report of a shared item, from its page's Report, for Farty to check. It names the share and
 * the item, never who reported it. Deleting the owner's account deletes it.
 */
export const shareReports = sqliteTable(
  'share_reports',
  {
    id: text('id').primaryKey(),
    shareId: text('share_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['recordings', 'toots'] }).notNull(),
    itemId: text('item_id').notNull(),
    createdAt: timestamp('created_at').notNull()
  },
  table => [index('share_reports_created_at_idx').on(table.createdAt)]
)

// Friends (#319, ADR 0021): a request from one user to another, found by their Handle, and once
// it's accepted a friendship, kept as a row each way. Deleting either account deletes both.

/**
 * A friend request: `from_user_id` asked `to_user_id`, who hasn't accepted or declined yet.
 * Accepting makes the friendship and deletes the request; declining or cancelling deletes it.
 */
export const friendRequests = sqliteTable(
  'friend_requests',
  {
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull()
  },
  table => [
    primaryKey({ columns: [table.fromUserId, table.toUserId] }),
    index('friend_requests_to_user_id_idx').on(table.toUserId),
    check('friend_requests_not_self', sql`from_user_id <> to_user_id`)
  ]
)

/**
 * A friendship, as a row each way: `user_id` is friends with `friend_id`, and the other row says
 * the reverse, so a user's friends are one indexed read. Removing a friend deletes both.
 */
export const friends = sqliteTable(
  'friends',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    friendId: text('friend_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull()
  },
  table => [
    primaryKey({ columns: [table.userId, table.friendId] }),
    // For deleting an account's friendships the other way, by `on delete cascade`.
    index('friends_friend_id_idx').on(table.friendId),
    check('friends_not_self', sql`user_id <> friend_id`)
  ]
)

/**
 * A report of a profile page, `/u/<handle>/`, from its Report, for Farty to check, such as for a
 * bad Handle. It names the user reported, never who reported them. Deleting that account deletes
 * it.
 */
export const profileReports = sqliteTable(
  'profile_reports',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull()
  },
  table => [
    index('profile_reports_created_at_idx').on(table.createdAt),
    // For deleting an account's reports by `on delete cascade`.
    index('profile_reports_user_id_idx').on(table.userId)
  ]
)
