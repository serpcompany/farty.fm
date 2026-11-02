import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { songs } from '../src/lib/catalog/songs.generated'

// What the reference engine's golden data (`fixtures/golden/`) says the Staging build's Fixture
// Library unlocks, so a journey's counts follow the catalog instead of a number typed here.

/** Whether the whole Fixture Library unlocks the Song, as the golden full-library Arrangement says. */
function unlockedByTheFixtureLibrary(id: string): boolean {
  const path = resolve(__dirname, '../../../fixtures/golden/arrangements/full', `${id}.json`)
  return (JSON.parse(readFileSync(path, 'utf8')) as { unlocked: boolean }).unlocked
}

/** The Songs the whole Fixture Library unlocks, in the catalog's order. */
export const songsTheFixtureLibraryUnlocks = songs.filter(song =>
  unlockedByTheFixtureLibrary(song.id)
)
