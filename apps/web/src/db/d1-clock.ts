import { sql } from 'drizzle-orm'

export const d1Now = sql<number>`cast(unixepoch('subsec') * 1000 as integer)`
