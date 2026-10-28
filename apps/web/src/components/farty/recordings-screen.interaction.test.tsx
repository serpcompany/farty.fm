import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Recording } from '@/lib/recordings'
import { button, closeScreens, dialogs, hideAndShowPage, show, tap } from '@/test-support/screen'
import { PlaybackProvider } from './playback-provider'
import { useRecordings } from './recordings-provider'
import { RecordingsScreen } from './recordings-screen'

vi.mock('@/lib/audio/player', () => ({ play: vi.fn(), stopPlayback: vi.fn() }))
vi.mock('@/lib/recording-store', () => ({ loadAudio: () => new Promise(() => undefined) }))
vi.mock('./record-flow-provider', () => ({ useRecordFlow: () => ({ retryAnalysis: vi.fn() }) }))
vi.mock('./recordings-provider', () => ({ useRecordings: vi.fn() }))

function saved(number: number): Recording {
  return {
    id: `r${number}`,
    number,
    createdAt: number,
    seconds: 1,
    sampleRate: 48_000,
    waveform: [],
    analysis: { state: 'notAnalyzed' }
  }
}

function noiseLike(number: number): Recording {
  return {
    ...saved(number),
    analysis: {
      state: 'analyzed',
      analysis: {
        gestureStartSeconds: 0,
        gestureEndSeconds: 0.9,
        cutAtReattack: false,
        pitchEstimateMidi: null,
        pitchConfidence: 0,
        recordingPitchMidi: null,
        shortestNoteSeconds: null
      }
    }
  }
}

function showRecordings(recordings: Recording[] | null) {
  vi.mocked(useRecordings).mockReturnValue({
    recordings,
    recording: (id: string) => recordings?.find(r => r.id === id),
    melodicRecordings: [],
    collectedNotes: new Set(),
    deleteRecording: vi.fn(),
    placeRecording: vi.fn()
  } as unknown as ReturnType<typeof useRecordings>)
  return show(
    <PlaybackProvider>
      <RecordingsScreen />
    </PlaybackProvider>
  )
}

const rowNames = () =>
  [...document.body.querySelectorAll('[data-testid="recording-row"] button[aria-pressed]')].map(
    row => row.getAttribute('aria-label')?.split(', ')[0]
  )

afterEach(closeScreens)

describe('Recordings', () => {
  it('lists the newest Recording first', async () => {
    await showRecordings([saved(1), saved(2), saved(3)])
    expect(rowNames()).toEqual(['Recording 3', 'Recording 2', 'Recording 1'])
  })

  it('shows a spinner while the Recordings load', async () => {
    await showRecordings(null)
    expect(document.body.querySelector('[role="status"]')).not.toBeNull()
    expect(rowNames()).toEqual([])
  })

  it('closes the Delete dialog when the page is hidden', async () => {
    await showRecordings([saved(1)])
    await tap(button('Delete Recording 1'))
    expect(dialogs().map(dialog => dialog.textContent)).toEqual([
      expect.stringContaining('Delete Recording 1?')
    ])

    await hideAndShowPage()
    expect(dialogs()).toEqual([])
  })

  it('opens the place-by-ear picker from a noise-like Recording, and closes it when the page is hidden', async () => {
    await showRecordings([noiseLike(1)])
    await tap(button('Recording 1 is noise-like. Place it on a note'))
    expect(dialogs().map(dialog => dialog.textContent)).toEqual([
      expect.stringContaining('Place Recording 1 on a note')
    ])

    await hideAndShowPage()
    expect(dialogs()).toEqual([])
  })
})
