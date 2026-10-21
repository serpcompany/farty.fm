// Node-only fixture decoding for the tests. Mirrors how the reference reads a file
// (`librosa.load` → soundfile → libsndfile): float32 samples per channel at the file's own
// rate, then channels averaged to mono. Resampling is left to `analyzeRecording`.
import { readFile } from 'node:fs/promises'
import { MPEGDecoder } from 'mpg123-decoder'

export interface DecodedFile {
  /** Mono float32, at the file's own rate. */
  samples: Float32Array
  sampleRate: number
  channels: number
  /** Frames per channel, as libsndfile reports them (`sf.info(path).frames`). */
  frames: number
}

export async function decodeFile(path: string): Promise<DecodedFile> {
  const bytes = new Uint8Array(await readFile(path))
  if (path.toLowerCase().endsWith('.wav')) return decodeWav(bytes)
  if (path.toLowerCase().endsWith('.mp3')) return decodeMp3(bytes)
  throw new Error(`Unsupported fixture format: ${path}`)
}

/**
 * MP3 through mpg123 (WASM), like libsndfile, which decodes MP3 with libmpg123 in gapless mode:
 * the encoder delay and padding recorded in the LAME/Xing header (plus mpg123's 529-sample
 * decoder delay) are trimmed, so the frame count equals libsndfile's.
 */
async function decodeMp3(bytes: Uint8Array): Promise<DecodedFile> {
  const decoder = new MPEGDecoder({ enableGapless: true })
  await decoder.ready
  try {
    const { channelData, samplesDecoded, sampleRate, errors } = decoder.decode(bytes)
    if (errors.length > 0) throw new Error(`MP3 decode errors: ${errors[0].message}`)
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

/** PCM WAV. libsndfile scales 16-bit samples by 1/32768 and 24/32-bit ones likewise. */
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
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first 2 bytes of the sub-format GUID.
      if (format === 0xfffe) format = view.getUint16(body + 24, true)
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

/** librosa.to_mono: the mean over channels, in float32. */
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
