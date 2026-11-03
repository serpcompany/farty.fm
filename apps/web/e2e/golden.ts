import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { songs } from '../src/lib/catalog/songs.generated'
import { coverageOf } from '../src/lib/pitch-coverage'
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

/** The Songs the whole Fixture Library unlocks, in the catalog's order. */
export const songsTheFixtureLibraryUnlocks = songsUnlockedBy(fixtureLibrary)
