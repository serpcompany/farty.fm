import '@/test-support/app-providers'
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Take } from '@/lib/audio/recorder'
import type { Analysis, AnalysisState, Recording, Trim } from '@/lib/recordings'
import { encodeWav, type PcmAudio } from '@/lib/wav'
import { button, closeScreens, show, tap as tapOn, type } from '@/test-support/screen'

const sampleRate = 48000

const page = vi.hoisted(() => ({
  startTake: vi.fn(),
  analyses: [] as ((found: unknown) => void)[],
  failures: [] as ((error: Error) => void)[],
  findTrim: vi.fn(),
  playPianoNote: vi.fn(),
  saved: null as Recording | null,
  wav: null as ArrayBuffer | null,
  stored: [] as Recording[],
  saveRecording: vi.fn(),
  saveAnalysis: vi.fn(),
  placeRecording: vi.fn(),
  openStep: vi.fn()
}))

vi.mock('@/lib/audio/recorder', () => ({ startTake: page.startTake }))
vi.mock('@/lib/analysis/client', () => ({
  analyze: () =>
    new Promise((resolve, reject) => {
      page.analyses.push(resolve)
      page.failures.push(reject)
    }),
  findTrim: page.findTrim
}))
vi.mock('@/lib/recording-store', () => ({
  onWaitingForOtherTabs: () => () => {},
  loadRecordings: async () => page.stored,
  loadAudio: async () => page.wav,
  saveRecording: page.saveRecording,
  saveAnalysis: page.saveAnalysis,
  placeRecording: page.placeRecording
}))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: () => undefined }))
vi.mock('./account-provider', () => ({
  useAccount: () => ({
    account: { status: 'signedOut' },
    offerStep: () => false,
    openStep: page.openStep
  })
}))
vi.mock('./piano-keys', async importOriginal => ({
  ...(await importOriginal<typeof import('./piano-keys')>()),
  playPianoNote: page.playPianoNote
}))

const { FartyProvider } = await import('./farty-provider')
const { useRecordFlow } = await import('./record-flow-provider')
const { useRecordings } = await import('./recordings-provider')
const { RecordFlow } = await import('./record-flow')
const { RecordingReview } = await import('./recording-review')

const found: Analysis = {
  gestureStartSeconds: 0.2,
  gestureEndSeconds: 0.8,
  cutAtReattack: false,
  pitchEstimateMidi: 55.2,
  pitchConfidence: 0.9,
  recordingPitchMidi: 55.2,
  shortestNoteSeconds: 0.2,
  settleSeconds: 0.03,
  version: 5
}

const fart = () => {
  let seed = 7
  return Float32Array.from({ length: sampleRate }, (_, i) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    const room = 1e-4 * (2 * (seed / 2 ** 31) - 1)
    const t = i / sampleRate
    return t >= 0.2 && t < 0.8 ? room + 0.1 * Math.sin(2 * Math.PI * 196 * t) : room
  })
}

function standInTake(audio: Float32Array): Take {
  return {
    sampleRate,
    listen: next => next(audio),
    stop: async (): Promise<PcmAudio> => ({ samples: audio, sampleRate }),
    cancel: () => undefined
  }
}

let flow: ReturnType<typeof useRecordFlow> | null = null
let library: ReturnType<typeof useRecordings> | null = null
const onClose = vi.fn()

function Probe() {
  flow = useRecordFlow()
  library = useRecordings()
  return null
}

function Edit({ id }: { id: string }) {
  const recording = useRecordings().recording(id)
  return recording ? <RecordingReview recording={recording} onClose={onClose} /> : null
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  page.analyses = []
  page.failures = []
  page.saved = null
  page.wav = null
  page.stored = []
  page.saveRecording.mockImplementation(async (fields: object, wav: ArrayBuffer) => {
    page.wav = wav
    page.saved = {
      id: 'r1',
      number: 1,
      createdAt: 0,
      analysis: { state: 'analyzing' },
      ...fields
    } as Recording
    return page.saved
  })
  page.placeRecording.mockImplementation(async (_id: string, change: object) => {
    if (page.saved) page.saved = { ...page.saved, ...change }
  })
  page.saveAnalysis.mockImplementation(async (_id: string, state: AnalysisState) => {
    if (page.saved) page.saved = { ...page.saved, analysis: state }
    return page.saved
  })
  page.findTrim.mockImplementation(async (_audio: PcmAudio, handles: Trim) => handles)
})

afterEach(() => {
  closeScreens()
  flow = null
  library = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function render(children: ReactNode) {
  await show(
    <FartyProvider>
      <Probe />
      {children}
    </FartyProvider>
  )
}

async function recordTake() {
  await render(<RecordFlow />)
  page.startTake.mockResolvedValue(standInTake(fart()))
  await act(async () => void flow?.startRecording())
  await act(async () => void flow?.stopRecording())
  expect(page.analyses).toHaveLength(1)
}

async function analysisFinds(analysis: Analysis | null) {
  page.failures.shift()
  await act(async () => page.analyses.shift()?.(analysis))
}

async function analysisFails() {
  page.analyses.shift()
  await act(async () => page.failures.shift()?.(new Error('the analysis worker failed')))
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const text = (id: string) => byTestId(id)?.textContent ?? ''

const tap = (name: string) => tapOn(button(name))

const nameInput = () => document.querySelector<HTMLInputElement>('#review-name')

async function typeName(value: string) {
  const input = nameInput()
  if (!input) throw new Error('no name')
  await type(input, value)
}

const handle = (which: 'start' | 'end') =>
  document.querySelector<HTMLElement>(`[data-handle="${which}"]`)

async function nudge(which: 'start' | 'end', key: 'ArrowLeft' | 'ArrowRight') {
  await act(async () =>
    handle(which)?.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true })
    )
  )
}

describe('the review after Stop (#314)', () => {
  it('saves at once while the note is still being found, with the name typed', async () => {
    await recordTake()
    expect(text('review-note')).toBe('Finding note…')
    expect(text('review-caption')).toBe("You can save now. The note shows here once it's found.")
    expect(nameInput()?.value).toBe('Recording 1')
    expect(handle('start')?.getAttribute('aria-valuenow')).toBe('0')
    expect(handle('end')?.getAttribute('aria-valuenow')).toBe('1')

    await typeName('Squeaker')
    await tap('Save')
    expect(page.saveRecording).toHaveBeenCalledTimes(1)
    expect(page.saveRecording.mock.calls[0][0]).toEqual({
      seconds: 1,
      sampleRate,
      waveform: expect.any(Array),
      name: 'Squeaker'
    })
    expect(page.findTrim).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Finding your note…')

    await analysisFinds(found)
    expect(page.saveAnalysis).toHaveBeenCalledWith('r1', { state: 'analyzed', analysis: found })
    expect(text('result-note')).toBe('G3')
  })

  it('shows the note found, and a key makes another the note, until Back to G3', async () => {
    await recordTake()
    await analysisFinds(found)
    expect(text('review-note')).toBe('G3')
    expect(text('review-octave')).toBe('Octave 3C3 – B3')
    expect(text('review-caption')).toBe('We heard G3. Tap a key to hear it and make it the note.')
    expect(button('G3').getAttribute('aria-pressed')).toBe('true')

    await tap('A3')
    expect(page.playPianoNote).toHaveBeenCalledWith(57)
    expect(text('review-note')).toBe('A3')
    expect(text('review-caption')).toBe('Changed from G3. Back to G3')
    expect(button('A3').getAttribute('aria-pressed')).toBe('true')
    expect(button('G3').className).toContain('inset-ring-2')

    await tap('Back to G3')
    expect(text('review-note')).toBe('G3')

    await tap('Octave down')
    await tap('A2')
    expect(text('review-note')).toBe('A2')
    await tap('Save')
    expect(page.saveRecording.mock.calls[0][0]).toMatchObject({ placedPitch: 45 })
    expect(page.saveRecording.mock.calls[0][0]).not.toHaveProperty('name')
  })

  it('leaves a fart out with "No note", and takes it back off', async () => {
    await recordTake()
    await analysisFinds(found)
    await tap('No note')
    expect(text('review-note')).toBe('No note')
    expect(button('No note').getAttribute('aria-pressed')).toBe('true')
    expect(text('review-caption')).toBe(
      'Songs leave it out. Tap a key to give it a note, or go back to G3'
    )
    await tap('No note')
    expect(text('review-note')).toBe('G3')

    await tap('No note')
    await tap('Save')
    expect(page.saveRecording.mock.calls[0][0]).toMatchObject({ placedPitch: -1 })
  })

  it('says a Noise-like take has no note, and a key gives it one', async () => {
    await recordTake()
    await analysisFinds({ ...found, recordingPitchMidi: null, shortestNoteSeconds: null })
    expect(text('review-note')).toBe('No note')
    expect(text('review-caption')).toBe(
      'No steady note found, so Songs leave it out. Tap a key if you hear one.'
    )
    await tap('E3')
    expect(text('review-caption')).toBe('Set by you. Tap another key to change it.')
    await tap('Save')
    expect(page.saveRecording.mock.calls[0][0]).toMatchObject({ placedPitch: 52 })
  })

  it('moves the keys to the octave of the note found, unless the user picked one', async () => {
    await recordTake()
    expect(text('review-octave')).toContain('Octave 3')
    await analysisFinds({ ...found, recordingPitchMidi: 45.1 })
    expect(text('review-note')).toBe('A2')
    expect(text('review-octave')).toContain('Octave 2')
  })

  it('opens the handles on the fart found, trims, resets, and saves the Trim', async () => {
    await recordTake()
    await analysisFinds(found)
    expect(handle('start')?.getAttribute('aria-valuenow')).toBe('0.2')
    expect(handle('end')?.getAttribute('aria-valuenow')).toBe('0.8')
    expect(text('review-length')).toBe('0.60 s')
    expect(document.body.textContent).toContain('Drag the pink ends to trim')

    await nudge('start', 'ArrowRight')
    expect(handle('start')?.getAttribute('aria-valuenow')).toBe('0.3')
    expect(text('review-length')).toBe('0.50 s')
    await tap('Reset to the fart Farty found')
    expect(handle('start')?.getAttribute('aria-valuenow')).toBe('0.2')

    await nudge('end', 'ArrowLeft')
    await tap('Save')
    expect(page.saveRecording).toHaveBeenCalledTimes(1)
    expect(page.findTrim).toHaveBeenCalledWith(expect.anything(), {
      startSeconds: 0.2,
      endSeconds: 0.7
    })
    expect(page.placeRecording).toHaveBeenCalledWith('r1', {
      trim: {
        startSeconds: 0.2,
        endSeconds: 0.7,
        fart: { startSeconds: 0.2, endSeconds: 0.7 }
      }
    })
  })

  it('says on Result when the fart between the handles couldn’t be found to trim', async () => {
    await recordTake()
    await analysisFinds(found)
    await nudge('end', 'ArrowLeft')
    page.findTrim.mockRejectedValueOnce(new Error('no fart'))
    await tap('Save')
    expect(page.placeRecording).not.toHaveBeenCalled()
    expect(text('result-note')).toBe('G3')
    expect(text('result-trim-failed')).toBe(
      "Couldn't save the trim, so it's kept whole. Trim it again from the Recordings tab."
    )
  })

  it('says it couldn’t find the note when analysis fails, as Result does', async () => {
    await recordTake()
    await analysisFails()
    expect(text('review-note')).toBe('Not found')
    expect(text('review-caption')).toBe("We couldn't find its note. Tap a key if you hear one.")
    expect(button('No note').getAttribute('aria-pressed')).toBe('false')
    expect(() => button('Retry')).toThrow()
    await tap('Save')
    expect(document.body.textContent).toContain("Saved, but we couldn't find its note")
  })

  it('still says the take was kept whole after Retry, when the Trim and the analysis both failed', async () => {
    await recordTake()
    await analysisFails()
    await nudge('end', 'ArrowLeft')
    page.findTrim.mockRejectedValueOnce(new Error('no fart'))
    await tap('Save')
    expect(document.body.textContent).toContain("Saved, but we couldn't find its note")
    await tap('Retry')
    await analysisFinds(found)
    expect(text('result-note')).toBe('G3')
    expect(text('result-trim-failed')).toBe(
      "Couldn't save the trim, so it's kept whole. Trim it again from the Recordings tab."
    )
  })

  it('throws the take away with Discard, saving nothing', async () => {
    await recordTake()
    await tap('Discard')
    expect(page.saveRecording).not.toHaveBeenCalled()
    expect(byTestId('review-note')).toBeNull()
  })

  it('offers Share once the take is saved, and a guest makes an account first (#320)', async () => {
    await recordTake()
    await analysisFinds(found)
    expect(document.querySelector('[aria-label^="Share"]')).toBeNull()
    await typeName('Squeaker')
    await tap('Save')
    expect(text('result-note')).toBe('G3')
    await tap('Share Squeaker')
    expect(page.openStep).toHaveBeenCalledWith(expect.any(Function), 'share')
  })
})

describe('a saved Recording’s review (#314)', () => {
  const saved: Recording = {
    id: 'r7',
    number: 7,
    createdAt: 0,
    seconds: 1,
    sampleRate,
    waveform: [],
    placedPitch: 48,
    name: 'Squeaker',
    trim: {
      startSeconds: 0.3,
      endSeconds: 0.7,
      fart: { startSeconds: 0.31, endSeconds: 0.69 }
    },
    analysis: { state: 'analyzed', analysis: found }
  }

  async function edit(recording: Recording) {
    page.stored = [recording]
    page.wav = encodeWav({ samples: fart(), sampleRate })
    await render(<Edit id={recording.id} />)
  }

  it('opens on its Placed Pitch, its Trim and its name, and Cancel changes nothing', async () => {
    await edit(saved)
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Squeaker')
    expect(text('review-note')).toBe('C3')
    expect(text('review-caption')).toBe('Changed from G3. Back to G3')
    expect(handle('start')?.getAttribute('aria-valuenow')).toBe('0.3')
    expect(nameInput()?.value).toBe('Squeaker')

    await tap('Cancel')
    expect(onClose).toHaveBeenCalled()
    expect(page.placeRecording).not.toHaveBeenCalled()
  })

  it('renames it and sets the note at once, the title following the name', async () => {
    await edit(saved)
    await typeName('Big One')
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Big One')
    await tap('Back to G3')
    await tap('Save')
    expect(page.placeRecording).toHaveBeenCalledWith('r7', { placedPitch: null, name: 'Big One' })
    expect(onClose).toHaveBeenCalled()
    expect(library?.recording('r7')).toMatchObject({ placedPitch: null, name: 'Big One' })
  })

  it('takes the name off when it is emptied, back to "Recording 7"', async () => {
    await edit(saved)
    await typeName('  ')
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Recording 7'
    )
    await tap('Save')
    expect(page.placeRecording).toHaveBeenCalledWith('r7', { name: null })
  })

  it('says it couldn’t find the note when not analyzed, with Retry, as Result does', async () => {
    await edit({ ...saved, placedPitch: null, analysis: { state: 'notAnalyzed' } })
    expect(text('review-note')).toBe('Not found')
    expect(text('review-caption')).toBe(
      "We couldn't find its note. Tap a key if you hear one, or Retry"
    )
    await tap('Retry')
    expect(page.analyses).toHaveLength(1)
    expect(text('review-note')).toBe('Finding note…')
  })

  it('trims a Melodic Recording, and stays open saying so when the fart can’t be found', async () => {
    await edit({ ...saved, placedPitch: null, trim: null })
    expect(handle('start')?.getAttribute('aria-valuenow')).toBe('0.2')
    page.findTrim.mockRejectedValueOnce(new Error('no fart'))
    await nudge('start', 'ArrowRight')
    await tap('Save')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't save the trim. Try again."
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(page.placeRecording).not.toHaveBeenCalled()

    await tap('Save')
    expect(page.placeRecording).toHaveBeenCalledWith('r7', {
      trim: { startSeconds: 0.3, endSeconds: 0.8, fart: { startSeconds: 0.3, endSeconds: 0.8 } }
    })
    expect(onClose).toHaveBeenCalled()
  })
})
