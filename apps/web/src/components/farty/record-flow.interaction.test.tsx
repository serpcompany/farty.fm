import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetDecoded } from '@/lib/audio/player'
import { songs } from '@/lib/catalog/songs.generated'
import type { Recording } from '@/lib/recordings'
import { button, closeScreens, dialogs, show, tap } from '@/test-support/screen'
import { RecordFlow } from './record-flow'
import { useRecordFlow } from './record-flow-provider'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }))
vi.mock('./account-provider', () => ({ useAccount: () => ({ offerStep: vi.fn() }) }))
const togglePlayback = vi.hoisted(() => vi.fn())
vi.mock('./playback-provider', () => ({
  usePlayback: () => ({ nowPlaying: null, togglePlayback })
}))
vi.mock('@/lib/audio/player', () => ({ forgetDecoded: vi.fn() }))
vi.mock('./record-flow-provider', () => ({ useRecordFlow: vi.fn() }))
vi.mock('./recordings-provider', () => ({
  useRecordings: () => ({
    recording: () => recording,
    collectedPitchClasses: new Set([9]),
    melodicRecordings: [recording]
  })
}))

const recording: Recording = {
  id: 'r1',
  number: 1,
  createdAt: 1,
  seconds: 1,
  sampleRate: 48_000,
  waveform: [],
  analysis: {
    state: 'analyzed',
    analysis: {
      gestureStartSeconds: 0,
      gestureEndSeconds: 1,
      cutAtReattack: false,
      pitchEstimateMidi: 57,
      pitchConfidence: 1,
      recordingPitchMidi: 57,
      shortestNoteSeconds: 1,
      settleSeconds: 0,
      version: 99
    }
  }
}

const saveDraft = vi.fn()
const closeFlow = vi.fn()

function showFlow(flow: ReturnType<typeof useRecordFlow>['flow']) {
  vi.mocked(useRecordFlow).mockReturnValue({
    flow,
    capture: { kind: 'idle' },
    saveDraft,
    closeFlow
  } as unknown as ReturnType<typeof useRecordFlow>)
  return show(<RecordFlow />)
}

const flowText = () => dialogs()[0]?.textContent
const resultCards = () =>
  [...document.body.querySelectorAll('[data-testid="result-card"]')].map(card => card.textContent)
const unlocking = (count: number) => ({
  kind: 'result' as const,
  id: 'r1',
  changes: { unlocked: songs.slice(0, count), improved: [], closest: null }
})

afterEach(() => {
  closeScreens()
  vi.clearAllMocks()
})

describe('the record flow', () => {
  it('decodes a take once however often Review plays it, and forgets it when Review closes', async () => {
    const audio = { samples: new Float32Array(1), sampleRate: 48_000 }
    await showFlow({ kind: 'review', draft: { audio, seconds: 1, waveform: [] } })
    await tap(button('Play'))
    await tap(button('Play'))
    const [[first], [second]] = togglePlayback.mock.calls
    expect(second.decodeKey).toBe(first.decodeKey)
    expect(forgetDecoded).not.toHaveBeenCalled()
    closeScreens()
    expect(forgetDecoded).toHaveBeenCalledWith(first.decodeKey)
  })

  it('says Finding your note… while Recording Analysis runs', async () => {
    await showFlow({ kind: 'analyzing', id: 'r1' })
    expect(flowText()).toBe('Recording 1Finding your note…')
  })

  it("says it couldn't save the Recording, with Discard and Try again", async () => {
    const draft = { audio: { samples: new Float32Array(1), sampleRate: 48_000 }, seconds: 1 }
    await showFlow({ kind: 'saveFailed', draft: { ...draft, waveform: [] } })
    expect(flowText()).toBe("New RecordingCouldn't save this RecordingDiscardTry again")

    await tap(button('Try again'))
    expect(saveDraft).toHaveBeenCalledOnce()
    await tap(button('Discard'))
    expect(closeFlow).toHaveBeenCalledOnce()
  })

  it('shows three or more Songs unlocked by one save as one card, with their titles', async () => {
    const titles = songs.slice(0, 3).map(song => song.title)
    await showFlow(unlocking(3))
    expect(resultCards()).toEqual([`You unlocked 3 Songs${titles.join(' · ')}`])
  })

  it('shows each of two Songs unlocked by one save on its own card', async () => {
    await showFlow(unlocking(2))
    expect(resultCards()).toEqual(songs.slice(0, 2).map(song => `You unlocked ${song.title}`))
  })
})
