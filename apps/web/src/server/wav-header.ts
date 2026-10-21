/** What an uploaded WAV's header says. */
export type WavHeader = { sampleRate: number; frames: number }

/** The sample rates a WAV may have: anything a browser's microphone or the renderer records at. */
const MIN_SAMPLE_RATE = 8000
const MAX_SAMPLE_RATE = 192_000

const HEADER_BYTES = 44

/**
 * The header of a WAV exactly as Pedos writes one (`encodeWav` in `src/lib/wav.ts`): a 44-byte
 * header of mono 16-bit PCM, whose RIFF and data sizes match the file, and at least one sample.
 * Null for anything else, so the bucket only ever holds audio the app can play.
 */
export function readWavHeader(bytes: Uint8Array): WavHeader | null {
  if (bytes.byteLength <= HEADER_BYTES) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  const dataBytes = bytes.byteLength - HEADER_BYTES
  const sampleRate = u32(24)
  const valid =
    tag(0) === 'RIFF' &&
    u32(4) === bytes.byteLength - 8 &&
    tag(8) === 'WAVE' &&
    tag(12) === 'fmt ' &&
    u32(16) === 16 &&
    u16(20) === 1 && // PCM
    u16(22) === 1 && // mono
    sampleRate >= MIN_SAMPLE_RATE &&
    sampleRate <= MAX_SAMPLE_RATE &&
    u32(28) === sampleRate * 2 &&
    u16(32) === 2 &&
    u16(34) === 16 &&
    tag(36) === 'data' &&
    u32(40) === dataBytes &&
    dataBytes % 2 === 0
  return valid ? { sampleRate, frames: dataBytes / 2 } : null
}
