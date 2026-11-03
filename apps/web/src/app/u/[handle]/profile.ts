import 'server-only'

import { cache } from 'react'
import { getDb } from '@/db'
import { findProfile, type Profile } from '@/server/profiles'

export const profileView = cache(
  (handle: string): Promise<Profile | null> => findProfile(getDb(), handle)
)
