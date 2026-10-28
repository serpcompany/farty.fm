import { describe, expect, it } from 'vitest'
import {
  goldenArrangement,
  goldenRecording,
  goldenSong,
  libraries,
  songIds
} from '@/test-support/engine-golden'
import { beatRecordings, songBeats } from './beats'

// Where Beats go (ADR 0014): one on each of the score's bar lines, the Noise-like Recordings
// taking turns, checked against the reference's `plan_beats()` through the goldens.

describe('beatRecordings', () => {
  it('takes the Noise-like Recordings in id order, once each', () => {
    expect(beatRecordings({ bar_lines: [0, 4, 8, 12] }, ['065', '009', '065', '018'])).toEqual([
      '009',
      '018',
      '065'
    ])
  })

  it('keeps only as many as the Song has bars, since the rest never get a turn', () => {
    expect(beatRecordings({ bar_lines: [0, 3] }, ['065', '009', '018'])).toEqual(['009', '018'])
  })

  it('is empty with no Noise-like Recordings, or no bar lines', () => {
    expect(beatRecordings({ bar_lines: [0, 4] }, [])).toEqual([])
    expect(beatRecordings({ bar_lines: [] }, ['065'])).toEqual([])
  })
})

describe('songBeats', () => {
  it('puts one Beat on each bar line, to the next one, and the last to the end', () => {
    // Happy Birthday's shape: a one-beat pickup, then 3/4 bars, the last one short.
    const song = { bar_lines: [1, 4, 7], length_beats: 9 }
    expect(songBeats(song, ['065'])).toEqual([
      { bar: 0, recordingId: '065', start: 1, dur: 3 },
      { bar: 1, recordingId: '065', start: 4, dur: 3 },
      { bar: 2, recordingId: '065', start: 7, dur: 2 }
    ])
  })

  it('gives the pickup no Beat', () => {
    const beats = songBeats({ bar_lines: [1, 4], length_beats: 7 }, ['065'])
    expect(beats.every(b => b.start >= 1)).toBe(true)
  })

  it('takes turns bar by bar: bar k plays number k mod n', () => {
    const song = { bar_lines: [0, 4, 8, 12, 16], length_beats: 20 }
    expect(songBeats(song, ['009', '018']).map(b => b.recordingId)).toEqual([
      '009',
      '018',
      '009',
      '018',
      '009'
    ])
  })

  it('has no Beats without Recordings to play them', () => {
    expect(songBeats({ bar_lines: [0, 4], length_beats: 8 }, [])).toEqual([])
  })

  it("matches the reference's Beats on every golden Song", () => {
    const noiseLike = libraries.full.filter(id => !goldenRecording(id).melodic)
    let checked = 0
    for (const id of songIds) {
      const golden = goldenArrangement('full', id)
      if (golden.beats === null) continue
      const song = goldenSong(id)
      const mine = songBeats(song, beatRecordings(song, noiseLike))
      expect(
        mine.map(b => [b.bar, b.start, b.dur, b.recordingId]),
        id
      ).toEqual(golden.beats.map(b => [b.bar, b.start_beat, b.dur_beats, b.recording]))
      checked++
    }
    expect(checked).toBe(9)
  })
})
