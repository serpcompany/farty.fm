import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  type SQLiteColumnBuilderBase,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import type { Performance } from '../lib/performance'
import type { Analysis } from '../lib/recordings'
import type { TootArrangement } from '../lib/toot'

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })
const flag = (name: string) => integer(name, { mode: 'boolean' })
const betterAuthTimes = () => ({
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
})

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: flag('email_verified').notNull().default(false),
  image: text('image'),
  marketingEmail: flag('marketing_email').notNull().default(true),
  ...betterAuthTimes()
})

const userReference = (name = 'user_id') =>
  text(name)
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: userReference(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...betterAuthTimes()
  },
  table => [index('session_user_id_idx').on(table.userId)]
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: userReference(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    ...betterAuthTimes()
  },
  table => [index('account_user_id_idx').on(table.userId)]
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    ...betterAuthTimes()
  },
  table => [index('verification_identifier_idx').on(table.identifier)]
)

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

function libraryTable<
  TName extends string,
  TColumns extends Record<string, SQLiteColumnBuilderBase>
>(name: TName, columns: TColumns, checks: ReturnType<typeof check>[] = []) {
  return sqliteTable(
    name,
    {
      userId: userReference(),
      id: text('id').notNull(),
      ...columns,
      audioBytes: integer('audio_bytes').notNull(),
      updatedAt: timestamp('updated_at').notNull(),
      deletedAt: timestamp('deleted_at')
    },
    table => [
      primaryKey({ columns: [table.userId, table.id] }),
      index(`${name}_user_id_updated_at_idx`).on(table.userId, table.updatedAt),
      ...checks
    ]
  )
}

export const recordings = libraryTable('recordings', {
  number: integer('number').notNull(),
  createdAt: timestamp('created_at').notNull(),
  seconds: real('seconds').notNull(),
  sampleRate: integer('sample_rate').notNull(),
  waveform: text('waveform', { mode: 'json' }).$type<number[]>().notNull(),
  analysis: text('analysis', { mode: 'json' }).$type<Analysis>(),
  placedPitch: integer('placed_pitch'),
  trimStartSeconds: real('trim_start_seconds'),
  trimEndSeconds: real('trim_end_seconds'),
  trimFartStartSeconds: real('trim_fart_start_seconds'),
  trimFartEndSeconds: real('trim_fart_end_seconds'),
  name: text('name')
})

export const toots = libraryTable(
  'toots',
  {
    title: text('title').notNull(),
    songId: text('song_id'),
    createdAt: timestamp('created_at').notNull(),
    seconds: real('seconds').notNull(),
    arrangement: text('arrangement', { mode: 'json' }).$type<TootArrangement>(),
    performance: text('performance', { mode: 'json' }).$type<Performance>()
  },
  [
    check(
      'toots_song_or_performance',
      sql`(song_id is not null and arrangement is not null and performance is null)
        or (song_id is null and arrangement is null and performance is not null)`
    )
  ]
)

export const favoriteSongs = sqliteTable(
  'favorite_songs',
  {
    userId: userReference(),
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

export const tootPayments = sqliteTable(
  'toot_payments',
  {
    userId: userReference(),
    tootId: text('toot_id').notNull(),
    checkoutSessionId: text('checkout_session_id').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    songId: text('song_id'),
    createdAt: timestamp('created_at').notNull(),
    paidAt: timestamp('paid_at'),
    savedAt: timestamp('saved_at')
  },
  table => [primaryKey({ columns: [table.userId, table.tootId] })]
)

const sharedKind = () => text('kind', { enum: ['recordings', 'toots'] }).notNull()

export const handles = sqliteTable('handles', {
  userId: userReference().primaryKey(),
  handle: text('handle').notNull().unique(),
  createdAt: timestamp('created_at').notNull()
})

export const shares = sqliteTable(
  'shares',
  {
    id: text('id').primaryKey(),
    userId: userReference(),
    kind: sharedKind(),
    itemId: text('item_id').notNull(),
    createdAt: timestamp('created_at').notNull(),
    takenDownAt: timestamp('taken_down_at')
  },
  table => [
    uniqueIndex('shares_user_id_kind_item_id_idx').on(table.userId, table.kind, table.itemId)
  ]
)

export const shareReports = sqliteTable(
  'share_reports',
  {
    id: text('id').primaryKey(),
    shareId: text('share_id').notNull(),
    userId: userReference(),
    kind: sharedKind(),
    itemId: text('item_id').notNull(),
    createdAt: timestamp('created_at').notNull()
  },
  table => [index('share_reports_created_at_idx').on(table.createdAt)]
)

export const friendRequests = sqliteTable(
  'friend_requests',
  {
    fromUserId: userReference('from_user_id'),
    toUserId: userReference('to_user_id'),
    createdAt: timestamp('created_at').notNull()
  },
  table => [
    primaryKey({ columns: [table.fromUserId, table.toUserId] }),
    index('friend_requests_to_user_id_idx').on(table.toUserId),
    check('friend_requests_not_self', sql`from_user_id <> to_user_id`)
  ]
)

export const friends = sqliteTable(
  'friends',
  {
    userId: userReference(),
    friendId: userReference('friend_id'),
    createdAt: timestamp('created_at').notNull()
  },
  table => [
    primaryKey({ columns: [table.userId, table.friendId] }),
    index('friends_friend_id_idx').on(table.friendId),
    check('friends_not_self', sql`user_id <> friend_id`)
  ]
)

export const profileReports = sqliteTable(
  'profile_reports',
  {
    id: text('id').primaryKey(),
    userId: userReference(),
    createdAt: timestamp('created_at').notNull()
  },
  table => [
    index('profile_reports_created_at_idx').on(table.createdAt),
    index('profile_reports_user_id_idx').on(table.userId)
  ]
)
