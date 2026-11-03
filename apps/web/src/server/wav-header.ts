type WavHeader = { sampleRate: number; frames: number }

const MIN_SAMPLE_RATE = 8000
const MAX_SAMPLE_RATE = 192_000

export const HEADER_BYTES = 44
const FMT_CHUNK_BYTES = 16
const PCM_FORMAT = 1
const MONO = 1
const BYTES_PER_SAMPLE = 2
const BITS_PER_SAMPLE = 16

export function readWavHeader(bytes: Uint8Array): WavHeader | null {
  return wavHeaderOf(bytes.subarray(0, HEADER_BYTES), bytes.byteLength)
}

export function wavHeaderOf(head: Uint8Array, fileBytes: number): WavHeader | null {
  if (fileBytes <= HEADER_BYTES || head.byteLength < HEADER_BYTES) return null
  const view = new DataView(head.buffer, head.byteOffset, HEADER_BYTES)
  const tag = (offset: number) => String.fromCharCode(...head.subarray(offset, offset + 4))
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  const dataBytes = fileBytes - HEADER_BYTES
  const sampleRate = u32(24)
  const valid =
    tag(0) === 'RIFF' &&
    u32(4) === fileBytes - 8 &&
    tag(8) === 'WAVE' &&
    tag(12) === 'fmt ' &&
    u32(16) === FMT_CHUNK_BYTES &&
    u16(20) === PCM_FORMAT &&
    u16(22) === MONO &&
    sampleRate >= MIN_SAMPLE_RATE &&
    sampleRate <= MAX_SAMPLE_RATE &&
    u32(28) === sampleRate * BYTES_PER_SAMPLE &&
    u16(32) === BYTES_PER_SAMPLE &&
    u16(34) === BITS_PER_SAMPLE &&
    tag(36) === 'data' &&
    u32(40) === dataBytes &&
    dataBytes % BYTES_PER_SAMPLE === 0
  return valid ? { sampleRate, frames: dataBytes / BYTES_PER_SAMPLE } : null
}
