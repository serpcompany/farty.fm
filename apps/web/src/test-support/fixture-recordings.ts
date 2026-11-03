import type { Song, SongSummary } from '@/lib/catalog/song'
import { fixtureRecordingId } from '@/lib/fixture-library'
import { type SongOrder, songListing, songRows, sortRows } from '@/lib/pitch-coverage'
import type { Recording } from '@/lib/recordings'
import { goldenArrangement, goldenRecording, storedAnalysis } from './engine-golden'
import { goldenIndex } from './golden'
import { songs } from './songs.generated'

export const story = [
  '018',
  '032',
  '090',
  '052',
  '094',
  '069',
  '017',
  '086',
  '002',
  '084',
  '013',
  '055'
]

function fixtureRecording(id: string, number: number): Recording {
  const golden = goldenRecording(id)
  return {
    id: fixtureRecordingId(id),
    number,
    createdAt: 0,
    seconds: golden.file.frames / golden.file.sample_rate,
    sampleRate: golden.file.sample_rate,
    waveform: [],
    analysis: { state: 'analyzed', analysis: storedAnalysis(golden) }
  }
}

export const fixtures = (ids: readonly string[]) => ids.map((id, i) => fixtureRecording(id, i + 1))
export const allFixtures = fixtures(goldenIndex.recordings)
export const without002 = allFixtures.filter(r => r.id !== fixtureRecordingId('002'))
export const takes = (count: number) => fixtures(story.slice(0, count))

export function catalogSong(id: string): Song {
  const found = songs.find(s => s.id === id)
  if (!found) throw new Error(`No Song ${id}`)
  return found
}

export const fixtureId = (recordingId: string | undefined) => recordingId?.slice(-3)

export const iPhoneSongs = songs.slice(0, 12)

export const iPhoneListing = (recordings: Recording[], order: SongOrder = 'closestToUnlocking') =>
  songListing(sortRows(songRows(iPhoneSongs, recordings), order), '')

export const unlockedByAll = (s: SongSummary) => goldenArrangement('full', s.id).unlocked
