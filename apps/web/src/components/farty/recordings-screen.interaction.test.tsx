import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RescanResult } from '@/lib/analysis-upgrade'
import { waitingForRoom } from '@/lib/library-sync'
import { announceQueued, announceSent } from '@/lib/outbox'
import type { Analysis, Recording } from '@/lib/recordings'
import {
  button,
  closeScreens,
  dialogs,
  hideAndShowPage,
  settle,
  show,
  tap
} from '@/test-support/screen'
import { PlaybackProvider } from './playback-provider'
import { RecordingsScreen } from './recordings-screen'
import type { Rescanning } from './use-rescan'

const page = vi.hoisted(() => ({
  recordings: null as Recording[] | null,
  rescanning: null as Rescanning | null,
  rescanned: null as RescanResult | null,
  rescanAll: vi.fn<() => Promise<RescanResult>>(),
  rescanRecording: vi.fn<(id: string) => Promise<RescanResult>>(),
  setReviewOpen: vi.fn<(open: boolean) => void>()
}))

vi.mock('@/lib/audio/player', () => ({
  play: vi.fn(),
  stopPlayback: vi.fn(),
  playbackPosition: () => null
}))
vi.mock('@/lib/library-sync', () => ({ waitingForRoom: vi.fn(async () => 0) }))
vi.mock('@/lib/recording-store', () => ({ loadAudio: () => new Promise(() => undefined) }))
vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedOut' }, openStep: () => {} })
}))
vi.mock('./record-flow-provider', () => ({
  useRecordFlow: () => ({
    retryAnalysis: vi.fn(),
    setReviewOpen: page.setReviewOpen,
    draftSound: () => null
  })
}))
vi.mock('./recordings-provider', () => ({
  useRecordings: () => ({
    recordings: page.recordings,
    recording: (id: string) => page.recordings?.find(r => r.id === id),
    melodicRecordings: [],
    collectedNotes: new Set(),
    deleteRecording: vi.fn(),
    placeRecording: vi.fn(),
    rescanning: page.rescanning,
    rescanned: page.rescanned,
    rescanAll: page.rescanAll,
    rescanRecording: page.rescanRecording
  })
}))

const analysis = (recordingPitchMidi: number | null, version = 5): Analysis => ({
  gestureStartSeconds: 0,
  gestureEndSeconds: 0.9,
  cutAtReattack: false,
  pitchEstimateMidi: recordingPitchMidi,
  pitchConfidence: 0.5,
  recordingPitchMidi,
  shortestNoteSeconds: recordingPitchMidi === null ? null : 0.12,
  settleSeconds: null,
  version
})

const analyzed = (
  number: number,
  pitch: number | null,
  placedPitch?: number,
  version = 5
): Recording => ({
  id: `r${number}`,
  number,
  createdAt: number,
  seconds: 1,
  sampleRate: 48000,
  waveform: [],
  placedPitch,
  analysis: { state: 'analyzed', analysis: analysis(pitch, version) }
})

const notAnalyzedYet = (number: number): Recording => ({
  ...analyzed(number, null),
  analysis: { state: 'notAnalyzed' }
})

const melodic = analyzed(1, 55)
const noNoteFromAnOlderAnalysis = analyzed(2, null, undefined, 4)
const noNoteFromTheCurrentAnalysis = analyzed(7, null)
const placedOnC3ThenFoundG3 = analyzed(3, 55, 48)
const placedNoiseLike = analyzed(4, null, 50)
const notAnalyzed = notAnalyzedYet(5)

async function showRecordings(
  recordings: Recording[] | null,
  rescanning: Rescanning | null = null,
  rescanned: RescanResult | null = null
) {
  page.recordings = recordings
  page.rescanning = rescanning
  page.rescanned = rescanned
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

const accountFull = () =>
  document.body.querySelector('output [data-testid="account-full"]')?.textContent

const findButton = (name: string) =>
  [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === name || b.textContent === name
  )

const status = () => document.querySelector('[data-testid="rescan-status"]')?.textContent

afterEach(() => {
  closeScreens()
  vi.mocked(waitingForRoom).mockResolvedValue(0)
  vi.clearAllMocks()
})

describe('Recordings', () => {
  it('lists the newest Recording first', async () => {
    await showRecordings([notAnalyzedYet(1), notAnalyzedYet(2), notAnalyzedYet(3)])
    expect(rowNames()).toEqual(['Recording 3', 'Recording 2', 'Recording 1'])
  })

  it('shows a spinner while the Recordings load', async () => {
    await showRecordings(null)
    expect(document.body.querySelector('[role="status"]')).not.toBeNull()
    expect(rowNames()).toEqual([])
  })

  it('closes the Delete dialog when the page is hidden', async () => {
    await showRecordings([notAnalyzedYet(1)])
    await tap(button('Delete Recording 1'))
    expect(dialogs().map(dialog => dialog.textContent)).toEqual([
      expect.stringContaining('Delete Recording 1?')
    ])

    await hideAndShowPage()
    expect(dialogs()).toEqual([])
  })

  it('says how many Recordings wait for room while the account is full, until they upload', async () => {
    vi.mocked(waitingForRoom).mockResolvedValue(2)
    await showRecordings([notAnalyzedYet(1), notAnalyzedYet(2), notAnalyzedYet(3)])
    await settle()
    expect(accountFull()).toBe(
      'Your account is full, so 2 Recordings are only on this device. Delete some older ones to make room.'
    )
    expect(vi.mocked(waitingForRoom).mock.calls).toEqual([['recordings']])

    vi.mocked(waitingForRoom).mockResolvedValue(1)
    await act(async () => announceQueued())
    await settle()
    expect(accountFull()).toBe(
      'Your account is full, so 1 Recording is only on this device. Delete some older ones to make room.'
    )

    vi.mocked(waitingForRoom).mockResolvedValue(0)
    await act(async () => announceSent())
    await settle()
    expect(accountFull()).toBeUndefined()
  })
})

describe('Re-scan on the Recordings tab (#282)', () => {
  it('offers Re-scan on each Recording an older analysis found no note in, and Re-scan all', async () => {
    await showRecordings([
      melodic,
      noNoteFromAnOlderAnalysis,
      placedOnC3ThenFoundG3,
      placedNoiseLike,
      notAnalyzed,
      noNoteFromTheCurrentAnalysis
    ])
    expect(findButton('Re-scan Recording 2')).toBeDefined()
    for (const n of [1, 3, 4, 5, 7])
      expect(findButton(`Re-scan Recording ${n}`), String(n)).toBeUndefined()
    expect(button('Re-scan all').disabled).toBe(false)
    expect(status()).toBe('')
  })

  it('has no Re-scan once the current analysis made every Recording’s', async () => {
    await showRecordings([
      melodic,
      placedOnC3ThenFoundG3,
      placedNoiseLike,
      noNoteFromTheCurrentAnalysis
    ])
    expect(findButton('Re-scan all')).toBeUndefined()
    expect(document.body.textContent).not.toContain('Re-scan')
  })

  it('runs Re-scan all, then says what changed', async () => {
    page.rescanAll.mockResolvedValue({ scanned: 3, found: 2, failed: 0 })
    const render = await showRecordings([melodic, noNoteFromAnOlderAnalysis])
    await tap(button('Re-scan all'))
    expect(page.rescanAll).toHaveBeenCalledOnce()
    page.rescanned = { scanned: 3, found: 2, failed: 0 }
    await render(
      <PlaybackProvider>
        <RecordingsScreen />
      </PlaybackProvider>
    )
    expect(status()).toBe('2 farts now have a note')
  })

  it('re-scans one Recording, then says when it found nothing new', async () => {
    page.rescanRecording.mockResolvedValue({ scanned: 1, found: 0, failed: 0 })
    const render = await showRecordings([melodic, noNoteFromAnOlderAnalysis])
    await tap(button('Re-scan Recording 2'))
    expect(page.rescanRecording).toHaveBeenCalledExactlyOnceWith('r2')
    page.rescanned = { scanned: 1, found: 0, failed: 0 }
    await render(
      <PlaybackProvider>
        <RecordingsScreen />
      </PlaybackProvider>
    )
    expect(status()).toBe('No new notes')
  })

  it('announces a result that came while the tab was closed, when it opens again (#295)', async () => {
    const added: Node[] = []
    const observer = new MutationObserver(records => {
      for (const r of records)
        if ((r.target as Element).getAttribute?.('data-testid') === 'rescan-status')
          added.push(...r.addedNodes)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    await showRecordings([melodic, noNoteFromAnOlderAnalysis], null, {
      scanned: 2,
      found: 1,
      failed: 0
    })
    await act(async () => {})
    observer.disconnect()
    expect(status()).toBe('1 fart now has a note')
    expect(added.map(n => n.textContent)).toEqual(['1 fart now has a note'])
  })

  it('shows how far Re-scan all is and the Recording it is on, with Re-scan off meanwhile', async () => {
    const another = analyzed(6, null, undefined, 4)
    await showRecordings([noNoteFromAnOlderAnalysis, another], {
      recordingId: 'r2',
      done: 1,
      total: 3
    })
    expect(status()).toBe('Re-scanning 2 of 3')
    expect(document.querySelector('[data-testid="rescanning-2"]')).not.toBeNull()
    expect(findButton('Re-scan Recording 2')).toBeUndefined()
    expect(button('Re-scan Recording 6').disabled).toBe(true)
    expect(button('Re-scan all').disabled).toBe(true)
  })

  it('keeps showing the Placed Pitch when a later analysis found a Recording Pitch', async () => {
    await showRecordings([placedOnC3ThenFoundG3])
    const note = document.querySelector('[data-testid="recording-note"]')
    expect(note?.textContent).toBe('C3')
    expect(button('Recording 3, 0.9 s, C3, placed by ear').getAttribute('aria-pressed')).toBe(
      'false'
    )
    expect(document.body.textContent).toContain('Placed by ear')
    expect(document.body.textContent).not.toContain('G3')
  })
})

describe('a Recording’s note and review on the Recordings tab (#314)', () => {
  const notes = () =>
    [...document.querySelectorAll('[data-testid="recording-note"]')].map(n => n.textContent)
  const review = () => document.querySelector<HTMLElement>('[role="dialog"]')

  it('shows the note Songs use, "No note" when they leave it out, and "Finding…"', async () => {
    const leftOut = analyzed(8, 55, -1)
    const finding: Recording = { ...analyzed(9, null), analysis: { state: 'analyzing' } }
    await showRecordings([melodic, noNoteFromTheCurrentAnalysis, leftOut, finding, notAnalyzed])
    expect(notes()).toEqual(['Finding…', 'No note', 'No note', 'G3'])
    expect(findButton('Recording 8, 0.9 s, No note')).toBeDefined()
    expect(findButton('Recording 7, 0.9 s, No note')).toBeDefined()
    expect(findButton('Recording 1, 0.9 s, G3')).toBeDefined()
    expect(document.body.textContent).not.toContain('noise-like')
  })

  it('names a Recording by the name the user gave it, and its pencil opens its review', async () => {
    await showRecordings([{ ...melodic, name: 'Squeaker' }])
    expect(findButton('Squeaker, 0.9 s, G3')).toBeDefined()
    const pencil = button('Edit Squeaker')
    expect(pencil.getAttribute('aria-haspopup')).toBe('dialog')
    await tap(pencil)
    expect(review()?.getAttribute('aria-label')).toBe('Squeaker')
    expect(review()?.querySelector('[data-testid="review-note"]')?.textContent).toBe('G3')

    await tap(button('Cancel'))
    expect(review()).toBeNull()
  })

  it('closes the review when the page is hidden', async () => {
    await showRecordings([{ ...melodic, name: 'Squeaker' }])
    await tap(button('Edit Squeaker'))
    expect(review()).not.toBeNull()

    await hideAndShowPage()
    expect(review()).toBeNull()
  })

  it('opens its review as a modal: focus moves in, Escape is Cancel, focus goes back', async () => {
    await showRecordings([{ ...melodic, name: 'Squeaker' }])
    const pencil = button('Edit Squeaker')
    pencil.focus()
    await tap(pencil)
    expect(review()?.getAttribute('aria-modal')).toBe('true')
    expect(page.setReviewOpen).toHaveBeenLastCalledWith(true)
    await vi.waitFor(() => expect(review()?.contains(document.activeElement)).toBe(true))
    expect(pencil.closest('[inert], [aria-hidden="true"]')).not.toBeNull()

    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    )
    await vi.waitFor(() => expect(review()).toBeNull())
    expect(page.setReviewOpen).toHaveBeenLastCalledWith(false)
    await vi.waitFor(() => expect(document.activeElement).toBe(pencil))
  })
})
