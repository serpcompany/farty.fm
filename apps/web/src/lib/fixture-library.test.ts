import { describe, expect, it } from 'vitest'
import { fixtures, fixtureWav } from '../../scripts/fixture-library'
import { goldenArrangement, goldenRecording } from '../test-support/engine-golden'
import { analyzeToAnalysis } from './analysis/port'
import { songs } from './catalog/songs.generated'
import { fixtureRecordingId } from './fixture-library'
import { coverageOf } from './pitch-coverage'
import type { Recording } from './recordings'
import { decodeWav } from './wav'

// The Fixture Library as the Staging build carries it: each fixture as the 16-bit WAV the app
// keeps, analyzed in the app as a new Recording is. It must unlock what the reference unlocks.

describe('the Fixture Library', () => {
  it('gives fixtures the iPhone app’s ids, which sort like fixture ids', () => {
    expect(fixtureRecordingId('090')).toBe('00000000-0000-0000-0000-000000000090')
    const ids = fixtures().map(f => fixtureRecordingId(f.id))
    expect(ids).toEqual([...ids].sort())
  })

  it('has the 32 fixtures of the golden library', () => {
    expect(fixtures().map(f => f.id)).toHaveLength(32)
  })

  it('analyzes as the reference does and unlocks every Song, as 16-bit WAV', async () => {
    const recordings: Recording[] = []
    for (const [i, { id, filename }] of fixtures().entries()) {
      const { samples, sampleRate } = decodeWav(await fixtureWav(filename))
      const analysis = analyzeToAnalysis(samples, sampleRate)
      const golden = goldenRecording(id)
      expect(analysis.recordingPitchMidi !== null, id).toBe(golden.melodic)
      if (golden.melodic && analysis.recordingPitchMidi !== null && golden.recording_pitch_midi) {
        expect(
          Math.abs(analysis.recordingPitchMidi - golden.recording_pitch_midi),
          id
        ).toBeLessThan(0.01)
      }
      recordings.push({
        id: fixtureRecordingId(id),
        number: i + 1,
        createdAt: 0,
        seconds: samples.length / sampleRate,
        sampleRate,
        waveform: [],
        analysis: { state: 'analyzed', analysis }
      })
    }
    for (const song of songs) {
      const coverage = coverageOf(song, recordings)
      const golden = goldenArrangement('full', song.id)
      expect(coverage.unlocked, song.id).toBe(true)
      expect(coverage.transposition, song.id).toBe(golden.transpose)
      for (const entry of golden.per_pitch) {
        expect(coverage.recordingForPitch.get(entry.song_pitch)?.slice(-3), song.id).toBe(
          entry.recording
        )
      }
    }
  })
})
