import { describe, expect, it } from 'vitest'
import { fixtures, fixtureWav } from '../../scripts/fixture-library'
import { goldenArrangement, goldenRecording } from '../test-support/engine-golden'
import { analyzeToAnalysis } from './analysis/port'
import { songs } from './catalog/songs.generated'
import { fixtureRecordingId, isFixtureRecording, newFixtureRecordingId } from './fixture-library'
import { coverageOf } from './pitch-coverage'
import type { Recording } from './recordings'
import { decodeWav } from './wav'

describe('the Fixture Library', () => {
  it('gives each load of a fixture a new id, which sorts like fixture ids', () => {
    const first = fixtures().map(f => newFixtureRecordingId(f.id))
    const again = fixtures().map(f => newFixtureRecordingId(f.id))
    expect(first).toEqual([...first].sort())
    expect(again).toEqual([...again].sort())
    for (const [i, fixture] of fixtures().entries()) {
      expect(first[i]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(first[i]).not.toBe(again[i])
      expect(isFixtureRecording(first[i], fixture.id)).toBe(true)
      expect(isFixtureRecording(again[i], fixture.id)).toBe(true)
    }
  })

  it('knows a fixture by the iPhone app’s id too, and nothing else as it', () => {
    expect(fixtureRecordingId('090')).toBe('00000000-0000-0000-0000-000000000090')
    expect(isFixtureRecording(fixtureRecordingId('090'), '090')).toBe(true)
    expect(isFixtureRecording(fixtureRecordingId('090'), '095')).toBe(false)
    expect(isFixtureRecording(newFixtureRecordingId('095'), '090')).toBe(false)
    expect(isFixtureRecording(crypto.randomUUID(), '090')).toBe(false)
  })

  it('has the 32 fixtures of the golden library', () => {
    expect(fixtures().map(f => f.id)).toHaveLength(32)
  })

  it('analyzes as the reference does and unlocks the Songs it does, as 16-bit WAV', async () => {
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
      expect(coverage.unlocked, song.id).toBe(
        !['jingle', 'row', 'amazing', 'auld'].includes(song.id)
      )
      expect(coverage.unlocked, song.id).toBe(golden.unlocked)
      expect(coverage.transposition, song.id).toBe(golden.transpose)
      for (const entry of golden.per_pitch) {
        expect(coverage.recordingForPitch.get(entry.song_pitch)?.slice(-3) ?? null, song.id).toBe(
          entry.recording
        )
      }
    }
  })
})
