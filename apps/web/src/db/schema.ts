import {
  index,
  integer,
  primaryKey,
  real,
  type SQLiteColumnBuilderBase,
  sqliteTable,
  text
} from 'drizzle-orm/sqlite-core'
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

const ownerId = () =>
  text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: ownerId(),
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
    userId: ownerId(),
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
>(name: TName, columns: TColumns) {
  return sqliteTable(
    name,
    {
      userId: ownerId(),
      id: text('id').notNull(),
      ...columns,
      audioBytes: integer('audio_bytes').notNull(),
      updatedAt: timestamp('updated_at').notNull(),
      deletedAt: timestamp('deleted_at')
    },
    table => [
      primaryKey({ columns: [table.userId, table.id] }),
      index(`${name}_user_id_updated_at_idx`).on(table.userId, table.updatedAt)
    ]
  )
}

export const recordings = libraryTable('recordings', {
  number: integer('number').notNull(),
  createdAt: timestamp('created_at').notNull(),
  seconds: real('seconds').notNull(),
  sampleRate: integer('sample_rate').notNull(),
  waveform: text('waveform', { mode: 'json' }).$type<number[]>().notNull(),
  analysis: text('analysis', { mode: 'json' }).$type<Analysis>()
})

export const toots = libraryTable('toots', {
  title: text('title').notNull(),
  songId: text('song_id').notNull(),
  createdAt: timestamp('created_at').notNull(),
  seconds: real('seconds').notNull(),
  arrangement: text('arrangement', { mode: 'json' }).$type<TootArrangement>().notNull()
})

export const tootPayments = sqliteTable(
  'toot_payments',
  {
    userId: ownerId(),
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
