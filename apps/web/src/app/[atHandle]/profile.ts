import 'server-only'

import { cache } from 'react'
import { getDb } from '@/db'
import { findProfile, type Profile } from '@/server/profiles'

/** The page at `/@<handle>/`, or null when no one has that Handle. Once per request. */
export const profileView = cache(
  (handle: string): Promise<Profile | null> => findProfile(getDb(), handle)
)
