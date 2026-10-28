import { describe, expect, it } from 'vitest'

import { encodeWav } from '@/lib/wav'

import { readWavHeader } from './wav-header'

const wav = (frames: number, sampleRate = 48_000) =>
  new Uint8Array(encodeWav({ samples: new Float32Array(frames), sampleRate }))

function patched(bytes: Uint8Array, offset: number, value: number, size: 2 | 4) {
  const copy = bytes.slice()
  const view = new DataView(copy.buffer)
  if (size === 2) view.setUint16(offset, value, true)
  else view.setUint32(offset, value, true)
  return copy
}

describe('readWavHeader', () => {
  it.each([8000, 44_100, 48_000, 96_000])('reads a WAV the app writes at %i Hz', sampleRate => {
    expect(readWavHeader(wav(1000, sampleRate))).toEqual({ sampleRate, frames: 1000 })
  })

  it('reads a WAV handed over as part of a larger buffer', () => {
    const inner = wav(10)
    const outer = new Uint8Array(inner.byteLength + 8)
    outer.set(inner, 4)
    expect(readWavHeader(outer.subarray(4, 4 + inner.byteLength))).toEqual({
      sampleRate: 48_000,
      frames: 10
    })
  })

  const good = wav(100)
  it.each([
    ['empty', new Uint8Array()],
    ['a header with no samples', wav(0)],
    ['text', new TextEncoder().encode('x'.repeat(100))],
    ['cut short', good.subarray(0, 100)],
    ['one byte longer than it says', new Uint8Array([...good, 0])],
    ['not RIFF', patched(good, 0, 0x58464952, 4)],
    ['a RIFF size that is not the file’s', patched(good, 4, 1000, 4)],
    ['a fmt chunk of another size', patched(good, 16, 18, 4)],
    ['float samples', patched(good, 20, 3, 2)],
    ['stereo', patched(good, 22, 2, 2)],
    ['a rate under 8 kHz', patched(patched(good, 24, 4000, 4), 28, 8000, 4)],
    ['a rate over 192 kHz', patched(patched(good, 24, 384_000, 4), 28, 768_000, 4)],
    ['a byte rate that is not 16-bit mono', patched(good, 28, 96_000 * 2, 4)],
    ['24-bit samples', patched(patched(good, 34, 24, 2), 32, 3, 2)],
    ['another chunk before the data', patched(good, 36, 0x5453494c, 4)],
    ['a data size that is not the file’s', patched(good, 40, 10, 4)]
  ])('refuses %s', (_, bytes) => {
    expect(readWavHeader(bytes)).toBeNull()
  })
})
