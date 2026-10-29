import type { BrowserContext, Page } from '@playwright/test'
import { all } from './database'
import { skipWelcome } from './record'
import { countStops, hearSounds } from './sounds'

export type StoredToot = {
  id: string
  title: string
  songId: string
  arrangement: { recordingForPitch: Record<string, string> }
}

export async function listenToTheToots(context: BrowserContext): Promise<void> {
  await context.addInitScript(skipWelcome, { offersInstall: false })
  await context.addInitScript(hearSounds)
  await context.addInitScript(countStops)
}

export async function tootOf(page: Page, songId: string): Promise<StoredToot> {
  const toot = (await all<StoredToot>(page, 'toots')).find(t => t.songId === songId)
  if (!toot) throw new Error(`No Toot of ${songId}`)
  return toot
}
