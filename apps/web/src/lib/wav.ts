export type PcmAudio = { samples: Float32Array; sampleRate: number }

type WavFormat = { format: number; channels: number; sampleRate: number; bits: number }

const pcmFormat = 1
const floatFormat = 3
const extensibleFormat = 0xfffe
const headerBytes = 44
const int16Scale = 0x8000

export function encodeWav({ samples, sampleRate }: PcmAudio): ArrayBuffer {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(headerBytes + dataBytes)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  const channels = 1
  const bytesPerFrame = 2
  ascii(0, 'RIFF')
  view.setUint32(4, headerBytes - 8 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, pcmFormat, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerFrame, true)
  view.setUint16(32, bytesPerFrame, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.round(samples[i] * int16Scale)
    view.setInt16(headerBytes + i * 2, Math.max(-int16Scale, Math.min(int16Scale - 1, value)), true)
  }
  return buffer
}

function readFormat(view: DataView, at: number): WavFormat {
  const tag = view.getUint16(at, true)
  return {
    format: tag === extensibleFormat ? view.getUint16(at + 24, true) : tag,
    channels: view.getUint16(at + 2, true),
    sampleRate: view.getUint32(at + 4, true),
    bits: view.getUint16(at + 14, true)
  }
}

function readMono(view: DataView, at: number, size: number, wav: WavFormat): Float32Array {
  const bytes = wav.bits / 8
  const frames = Math.floor(Math.min(size, view.byteLength - at) / (bytes * wav.channels))
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < wav.channels; c++) {
      sum += readSample(view, at + (i * wav.channels + c) * bytes, wav.format, wav.bits)
    }
    samples[i] = sum / wav.channels
  }
  return samples
}

export function decodeWav(buffer: ArrayBuffer): PcmAudio {
  const view = new DataView(buffer)
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(buffer, offset, 4).values())
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')
  let wav: WavFormat = { format: 0, channels: 0, sampleRate: 0, bits: 0 }
  for (let chunk = 12; chunk + 8 <= buffer.byteLength; ) {
    const size = view.getUint32(chunk + 4, true)
    const body = chunk + 8
    if (tag(chunk) === 'fmt ') wav = readFormat(view, body)
    else if (tag(chunk) === 'data') {
      return { samples: readMono(view, body, size, wav), sampleRate: wav.sampleRate }
    }
    chunk = body + size + (size % 2)
  }
  throw new Error('WAV file has no data')
}

function readSample(view: DataView, at: number, format: number, bits: number): number {
  if (format === floatFormat && bits === 32) return view.getFloat32(at, true)
  if (format === floatFormat && bits === 64) return view.getFloat64(at, true)
  switch (bits) {
    case 8:
      return (view.getUint8(at) - 128) / 128
    case 16:
      return view.getInt16(at, true) / int16Scale
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
