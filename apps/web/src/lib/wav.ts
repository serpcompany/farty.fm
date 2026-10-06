/**
 * Recordings are kept as mono 16-bit PCM WAV: lossless enough for analysis, half the size of
 * float, and every browser's `decodeAudioData` plays it.
 */

export type PcmAudio = { samples: Float32Array; sampleRate: number }

export function encodeWav({ samples, sampleRate }: PcmAudio): ArrayBuffer {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    // Scaled by 32768 and rounded, the inverse of how decoders (and decodeWav) read 16-bit PCM.
    const value = Math.round(samples[i] * 0x8000)
    view.setInt16(44 + i * 2, Math.max(-0x8000, Math.min(0x7fff, value)), true)
  }
  return buffer
}

/** Reads a WAV this module wrote, or any PCM (8/16/24/32-bit) or 32-bit float WAV, as mono. */
export function decodeWav(buffer: ArrayBuffer): PcmAudio {
  const view = new DataView(buffer)
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(buffer, offset, 4).values())
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')

  let format = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let offset = 12
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in its sub-format GUID.
      if (format === 0xfffe) format = view.getUint16(body + 24, true)
    } else if (id === 'data') {
      const bytes = bits / 8
      const frames = Math.floor(Math.min(size, buffer.byteLength - body) / (bytes * channels))
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let sum = 0
        for (let c = 0; c < channels; c++) {
          sum += readSample(view, body + (i * channels + c) * bytes, format, bits)
        }
        samples[i] = sum / channels
      }
      return { samples, sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV file has no data')
}

function readSample(view: DataView, at: number, format: number, bits: number): number {
  if (format === 3 && bits === 32) return view.getFloat32(at, true)
  if (format === 3 && bits === 64) return view.getFloat64(at, true)
  switch (bits) {
    case 8:
      return (view.getUint8(at) - 128) / 128
    case 16:
      return view.getInt16(at, true) / 0x8000
    case 24: {
      const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)
      return value / 0x800000
    }
    case 32:
      return view.getInt32(at, true) / 0x80000000
    default:
      throw new Error(`Unsupported WAV sample size: ${bits} bits`)
  }
}
