import { describe, expect, it, vi } from 'vitest'
import { AudioNotDownloaded } from '../recording-store'

// Why a Pad's sound fails to load: a download this browser can't fetch now (expected, not
// reported), or anything else, such as no audio anywhere, a database error or audio that won't
// decode (reported, `sound-pad.tsx`).

const decodeAudioData = vi.hoisted(() => vi.fn())
vi.mock('./context', () => ({
  audioContext: () => ({ decodeAudioData }),
  setPlaybackSession: () => undefined
}))

const { loadPadSound, PadAudioUnavailable } = await import('./pad-player')

describe('loadPadSound', () => {
  it('fails with PadAudioUnavailable when the download can’t be fetched now, and tries again', async () => {
    const offline = new AudioNotDownloaded('a')
    const wav = vi.fn(() => Promise.reject(offline))
    const first = loadPadSound('a', wav)
    await expect(first).rejects.toBeInstanceOf(PadAudioUnavailable)
    await expect(first).rejects.toMatchObject({ cause: offline })
    await expect(loadPadSound('a', wav)).rejects.toBeInstanceOf(PadAudioUnavailable)
    expect(wav).toHaveBeenCalledTimes(2)
    expect(decodeAudioData).not.toHaveBeenCalled()
  })

  it.each([
    ['there’s no audio for the Recording anywhere', new Error('No audio for Recording c')],
    ['the database can’t be read', new DOMException('Internal error', 'UnknownError')]
  ])('fails with the error itself when %s, so it’s reported', async (_, error) => {
    const loading = loadPadSound('c', () => Promise.reject(error))
    await expect(loading).rejects.toBe(error)
    await expect(loading).rejects.not.toBeInstanceOf(PadAudioUnavailable)
  })

  it('fails with the decode’s own error when the audio won’t decode', async () => {
    const broken = new DOMException('Unable to decode audio data', 'EncodingError')
    decodeAudioData.mockRejectedValueOnce(broken)
    const loading = loadPadSound('b', async () => new ArrayBuffer(8))
    await expect(loading).rejects.toBe(broken)
    await expect(loading).rejects.not.toBeInstanceOf(PadAudioUnavailable)
  })
})
