import { describe, expect, it, vi } from 'vitest'
import { AudioNotDownloaded } from '../recording-store'

// Why a Pad's sound fails to load: a download this browser can't fetch now (expected, not
// reported), or anything else, such as no audio anywhere, a database error or audio that won't
// decode, or the render worker's trim (reported, `sound-pad.tsx`).

const decodeAudioData = vi.hoisted(() => vi.fn())
vi.mock('./context', () => ({
  audioContext: () => ({ decodeAudioData }),
  setPlaybackSession: () => undefined
}))
const padSoundInWorker = vi.hoisted(() => vi.fn())
vi.mock('../engine/client', () => ({ padSoundInWorker }))

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

  it('fails with the render worker’s error when the trim fails, and tries again on the next call', async () => {
    const decoded = {
      numberOfChannels: 1,
      sampleRate: 48_000,
      getChannelData: () => new Float32Array(8)
    }
    decodeAudioData.mockResolvedValue(decoded)
    const crashed = new Error('The render worker stopped')
    const trimmed = new Float32Array([0.5, 0.25])
    padSoundInWorker.mockRejectedValueOnce(crashed).mockResolvedValueOnce([trimmed])
    class FakeAudioBuffer {
      channels: Float32Array[]
      constructor(readonly options: AudioBufferOptions) {
        this.channels = Array.from(
          { length: options.numberOfChannels ?? 1 },
          () => new Float32Array(options.length)
        )
      }
      copyToChannel(source: Float32Array, c: number) {
        this.channels[c].set(source)
      }
    }
    vi.stubGlobal('AudioBuffer', FakeAudioBuffer)
    try {
      const wav = vi.fn(async () => new ArrayBuffer(8))
      const first = loadPadSound('d', wav)
      await expect(first).rejects.toBe(crashed)
      await expect(first).rejects.not.toBeInstanceOf(PadAudioUnavailable)
      const sound = (await loadPadSound('d', wav)) as unknown as FakeAudioBuffer
      expect(wav).toHaveBeenCalledTimes(2)
      expect(padSoundInWorker).toHaveBeenCalledTimes(2)
      expect(sound.options).toMatchObject({ length: 2, numberOfChannels: 1, sampleRate: 48_000 })
      expect(sound.channels[0]).toEqual(trimmed)
    } finally {
      vi.unstubAllGlobals()
      decodeAudioData.mockReset()
    }
  })
})
