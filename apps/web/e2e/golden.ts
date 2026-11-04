import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'
import { coverageChanges, coverageOf, orderUnlocked } from '../src/lib/pitch-coverage'
import type { Recording } from '../src/lib/recordings'
import type { GoldenIndex, GoldenRecording } from '../src/test-support/golden'
import { goldenAnalysisRecording } from '../src/test-support/golden-analysis'

// What the Staging build's Fixture Library unlocks, read with the app's Pitch Coverage from the
// reference engine's analysis of each fixture (`fixtures/golden/recordings/`), so a journey's
// counts follow the catalog instead of a number typed here. `fixture-library.test.ts` checks
// that the app's own analysis of the fixtures unlocks the same Songs, and the reference's
// Arrangements the Songs it arranges.

const golden = resolve(__dirname, '../../../fixtures/golden')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
const index = readJson<GoldenIndex>(`${golden}/index.json`)

/** Recordings of these fixtures, in this order, with the reference's analysis. */
export const fixtureRecordings = (ids: readonly string[]) =>
  ids.map((id, i) =>
    goldenAnalysisRecording(
      readJson<GoldenRecording>(`${golden}/recordings/${id}.json`),
      i + 1,
      index.sample_rate
    )
  )

/** The whole Fixture Library, as the Staging build's loader adds it, in fixture id order. */
export const fixtureLibrary = fixtureRecordings(index.recordings)

/** The Songs these Recordings unlock, in the catalog's order. */
export const songsUnlockedBy = (recordings: Recording[]) =>
  songs.filter(song => coverageOf(song, recordings).unlocked)

/**
 * The Songs the last of these Recordings unlocks, in the order the Result's reward lists them
 * (#363): `favorites` first, then the most viewed. Pass the Recordings the app stored (with its own
 * analysis), as a journey's reward is worked out from them: a take's measured length can land on
 * either side of a Song's needed note length (#378), which the reference's analysis of the bare
 * fixture can't predict.
 */
export function songsTheLastRecordingUnlocks(
  recordings: readonly Recording[],
  favorites: readonly string[] = []
) {
  const { unlocked } = coverageChanges(songs, recordings.slice(0, -1), recordings)
  return orderUnlocked(unlocked, new Set(favorites)).map(u => u.song)
}

/**
 * The Songs the last of these fixtures unlocks by the reference's analysis, as `orderUnlocked`
 * lists them. For what holds whichever side of an edge a take lands on; a journey's exact reward
 * comes from `songsTheLastRecordingUnlocks`.
 */
export function songsTheLastTakeUnlocks(ids: readonly string[], favorites: readonly string[] = []) {
  return songsTheLastRecordingUnlocks(fixtureRecordings(ids), favorites)
}

/**
 * The Songs the last of the `stored` Recordings unlocks, takes of fixtures `ids`, checked against
 * the reference's analysis of them: every Song it predicts that an earlier take hasn't already
 * unlocked, and at most one more (#378).
 */
export function songsTheLastStoredTakeUnlocks(
  stored: readonly Recording[],
  ids: readonly string[],
  favorites: readonly string[] = []
) {
  const unlocked = songsTheLastRecordingUnlocks(stored, favorites)
  const predicted = songsTheLastTakeUnlocks(ids, favorites)
  const before = new Set(songsUnlockedBy(stored.slice(0, -1)).map(s => s.id))
  expect(stored).toHaveLength(ids.length)
  expect(unlocked.map(s => s.id)).toEqual(
    expect.arrayContaining(predicted.filter(s => !before.has(s.id)).map(s => s.id))
  )
  expect(unlocked.length).toBeLessThanOrEqual(predicted.length + 1)
  return unlocked
}

/** The Songs the whole Fixture Library unlocks, in the catalog's order. */
export const songsTheFixtureLibraryUnlocks = songsUnlockedBy(fixtureLibrary)
