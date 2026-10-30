import { describe, expect, it, vi } from 'vitest'

// Why a Pad's sound fails to load: audio this browser can't get yet (expected, not reported), or
// audio that won't decode (reported, `sound-pad.tsx`).

const decodeAudioData = vi.hoisted(() => vi.fn())
vi.mock('./context', () => ({
  audioContext: () => ({ decodeAudioData }),
  setPlaybackSession: () => undefined
}))

const { loadPadSound, PadAudioUnavailable } = await import('./pad-player')

describe('loadPadSound', () => {
  it('fails with PadAudioUnavailable when the audio isn’t in this browser, and tries again', async () => {
    const offline = new Error('No audio for Recording a')
    const wav = vi.fn(() => Promise.reject(offline))
    const first = loadPadSound('a', wav)
    await expect(first).rejects.toBeInstanceOf(PadAudioUnavailable)
    await expect(first).rejects.toMatchObject({ cause: offline })
    await expect(loadPadSound('a', wav)).rejects.toBeInstanceOf(PadAudioUnavailable)
    expect(wav).toHaveBeenCalledTimes(2)
    expect(decodeAudioData).not.toHaveBeenCalled()
  })

  it('fails with the decode’s own error when the audio won’t decode', async () => {
    const broken = new DOMException('Unable to decode audio data', 'EncodingError')
    decodeAudioData.mockRejectedValueOnce(broken)
    const loading = loadPadSound('b', async () => new ArrayBuffer(8))
    await expect(loading).rejects.toBe(broken)
    await expect(loading).rejects.not.toBeInstanceOf(PadAudioUnavailable)
  })
})
