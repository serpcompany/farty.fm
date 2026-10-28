import { readFile } from 'node:fs/promises'
import { MPEGDecoder } from 'mpg123-decoder'

const ID3V2_HEADER_BYTES = 10
const ID3V2_FOOTER_FLAG = 0x10
const MONO_CHANNEL_MODE = 3
const WAVE_FORMAT_EXTENSIBLE = 0xfffe

export interface DecodedFile {
  samples: Float32Array
  sampleRate: number
  channels: number
  frames: number
}

export async function decodeFile(path: string): Promise<DecodedFile> {
  const bytes = new Uint8Array(await readFile(path))
  if (path.toLowerCase().endsWith('.wav')) return decodeWav(bytes)
  if (path.toLowerCase().endsWith('.mp3')) return decodeMp3(bytes)
  throw new Error(`Unsupported fixture format: ${path}`)
}

async function decodeMp3(bytes: Uint8Array): Promise<DecodedFile> {
  const decoder = new MPEGDecoder({ enableGapless: true })
  await decoder.ready
  try {
    const decoded = decoder.decode(bytes)
    const { samplesDecoded, sampleRate, errors } = decoded
    if (errors.length > 0) throw new Error(`MP3 decode errors: ${errors[0].message}`)
    const channelData = isMonoMp3(bytes) ? decoded.channelData.slice(0, 1) : decoded.channelData
    return {
      samples: toMono(channelData, samplesDecoded),
      sampleRate,
      channels: channelData.length,
      frames: samplesDecoded
    }
  } finally {
    decoder.free()
  }
}

function isMonoMp3(bytes: Uint8Array): boolean {
  for (let at = afterId3v2Tag(bytes); at + 3 < bytes.length; at++) {
    if (isLayer3FrameSync(bytes, at)) return bytes[at + 3] >> 6 === MONO_CHANNEL_MODE
  }
  throw new Error('No MPEG audio frame found')
}

function afterId3v2Tag(bytes: Uint8Array): number {
  if (!(bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)) return 0
  const synchsafeSize = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]
  const footer = bytes[5] & ID3V2_FOOTER_FLAG ? ID3V2_HEADER_BYTES : 0
  return ID3V2_HEADER_BYTES + synchsafeSize + footer
}

function isLayer3FrameSync(bytes: Uint8Array, at: number): boolean {
  return bytes[at] === 0xff && (bytes[at + 1] & 0xe6) === 0xe2
}

function decodeWav(bytes: Uint8Array): DecodedFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file')
  let format = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let at = 12
  while (at + 8 <= bytes.length) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      if (format === WAVE_FORMAT_EXTENSIBLE) {
        const subFormatGuidStart = body + 24
        format = view.getUint16(subFormatGuidStart, true)
      }
    } else if (id === 'data') {
      const bytesPerSample = bits / 8
      const frames = Math.floor(Math.min(size, bytes.length - body) / (bytesPerSample * channels))
      const read = sampleReader(view, format, bits)
      const channelData = Array.from({ length: channels }, () => new Float32Array(frames))
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
          channelData[c][i] = read(body + (i * channels + c) * bytesPerSample)
        }
      }
      return { samples: toMono(channelData, frames), sampleRate, channels, frames }
    }
    at = body + size + (size % 2)
  }
  throw new Error('WAV file has no data chunk')
}

function sampleReader(view: DataView, format: number, bits: number): (at: number) => number {
  if (format === 1 && bits === 16) return at => view.getInt16(at, true) / 0x8000
  if (format === 1 && bits === 24) {
    return at => ((view.getInt8(at + 2) << 16) | view.getUint16(at, true)) / 0x800000
  }
  if (format === 1 && bits === 32) return at => view.getInt32(at, true) / 0x80000000
  if (format === 3 && bits === 32) return at => view.getFloat32(at, true)
  throw new Error(`Unsupported WAV sample format ${format} with ${bits} bits`)
}

function toMono(channelData: Float32Array[], frames: number): Float32Array {
  if (channelData.length === 1) return channelData[0].subarray(0, frames)
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (const channel of channelData) sum = Math.fround(sum + channel[i])
    mono[i] = sum / channelData.length
  }
  return mono
}
