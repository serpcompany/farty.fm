import { describe, expect, it } from 'vitest'

import { parseRecording, parseToot } from './library-input'

const ID = '11111111-1111-4111-8111-111111111111'
const PLAYER = '00000000-0000-0000-0000-000000000090'
const AT = Date.UTC(2026, 9, 21)

const analysis = {
  gestureStartSeconds: 0.01,
  gestureEndSeconds: 0.09,
  cutAtReattack: false,
  pitchEstimateMidi: 52,
  pitchConfidence: 0.8,
  recordingPitchMidi: 52.3,
  shortestNoteSeconds: 0.05
}

const recording = (fields: Record<string, unknown> = {}) => ({
  id: ID,
  number: 1,
  createdAt: AT,
  seconds: 0.1,
  sampleRate: 48_000,
  waveform: [0, 0.5, 1],
  analysis: { state: 'analyzed', analysis },
  ...fields
})

const toot = (recordingForPitch: unknown, fields: Record<string, unknown> = {}) => ({
  id: ID,
  title: 'Twinkle',
  songId: 'twinkle',
  createdAt: AT,
  seconds: 0.1,
  arrangement: { transposition: -12, recordingForPitch },
  ...fields
})

const pitches = (count: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, pitch) => [pitch, PLAYER]))

describe('parseRecording', () => {
  it('keeps only the Recording’s own fields, in the order it stores them', () => {
    const shuffled = Object.fromEntries(Object.entries(analysis).reverse())
    const sent = recording({
      extra: 'dropped',
      analysis: { state: 'analyzed', analysis: shuffled }
    })
    const kept = parseRecording(sent, ID, 48_000)
    expect(kept).toEqual({ ...recording(), analysis })
    expect(Object.keys(kept ?? {})).toEqual(Object.keys(recording()))
    expect(Object.keys(kept?.analysis ?? {})).toEqual(Object.keys(analysis))
  })

  it('takes a Recording that couldn’t be analyzed, whatever else its analysis holds', () => {
    const notAnalyzed = recording({ analysis: { state: 'notAnalyzed', analysis: 5 } })
    expect(parseRecording(notAnalyzed, ID, 48_000)?.analysis).toBeNull()
  })

  it('refuses another id, another sample rate, or an analysis of any other state', () => {
    expect(parseRecording(recording({ id: PLAYER }), ID, 48_000)).toBeNull()
    expect(parseRecording(recording(), ID, 44_100)).toBeNull()
    expect(parseRecording(recording({ analysis: { state: 'pending' } }), ID, 48_000)).toBeNull()
    expect(parseRecording([recording()], ID, 48_000)).toBeNull()
  })
})

describe('parseToot', () => {
  it('trims the title, and keys each pitch by its number', () => {
    const parsed = parseToot(toot({ '060': PLAYER }, { title: '  Bean Song  ' }), ID)
    expect(parsed?.title).toBe('Bean Song')
    expect(parsed?.arrangement.recordingForPitch).toEqual({ 60: PLAYER })
  })

  it('takes up to 128 pitches, each a number of up to 3 digits played by a Recording id', () => {
    expect(parseToot(toot(pitches(128)), ID)).not.toBeNull()
    expect(parseToot(toot(pitches(129)), ID)).toBeNull()
    expect(parseToot(toot({ 1000: PLAYER }), ID)).toBeNull()
    expect(parseToot(toot({ 60: 'not-an-id' }), ID)).toBeNull()
    expect(parseToot(toot([PLAYER]), ID)).toBeNull()
  })

  it('refuses a pitch named __proto__, as JSON can send one', () => {
    const sent = JSON.parse(JSON.stringify(toot({})).replace('{}', `{"__proto__":"${PLAYER}"}`))
    expect(Object.keys(sent.arrangement.recordingForPitch)).toEqual(['__proto__'])
    expect(parseToot(sent, ID)).toBeNull()
  })
})
