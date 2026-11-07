import { describe, expect, it } from 'vitest'

import { finerBars, waveformLevels } from './waveform'

describe('waveformLevels', () => {
  it("scales each slice's peak to the loudest", () => {
    expect(waveformLevels([0, 2, 0, 4, 0, 1, 0, 8], 4)).toEqual([0.25, 0.5, 0.125, 1])
  })

  it('is flat for silence or too little audio', () => {
    expect(waveformLevels([0, 0, 0, 0], 2)).toEqual([0.05, 0.05])
    expect(waveformLevels([1], 2)).toEqual([0.05, 0.05])
  })

  it("with a step, reads every step-th sample of each slice, as a long Toot's bars", () => {
    // Every other sample is loud in the first slice, so a step of 2 from its start still finds it.
    const samples = [8, 0, 8, 0, 0, 4, 0, 4]
    expect(waveformLevels(samples, 2, 2)).toEqual([1, 0.05])
    expect(waveformLevels(samples, 2)).toEqual([1, 0.5])
    // A fractional or zero step reads every sample.
    expect(waveformLevels(samples, 2, 0.5)).toEqual([1, 0.5])
  })
})

describe('finerBars', () => {
  it('draws the same shape in more bars', () => {
    expect(finerBars([0, 1], 4)).toEqual([0, 0.25, 0.75, 1])
  })

  it("fills them all from one level, as a short fart's one bar (#451)", () => {
    expect(finerBars([0.2], 3)).toEqual([0.2, 0.2, 0.2])
  })

  it('never draws fewer bars than it has, nor any from none', () => {
    expect(finerBars([0.2, 1, 0.5], 2)).toEqual([0.2, 1, 0.5])
    expect(finerBars([], 4)).toEqual([])
  })
})
