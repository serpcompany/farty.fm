import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { pianoNote } from '../src/components/pedos/piano-keys'
import { songs } from '../src/lib/catalog/songs.generated'
import { arrangementOf } from '../src/lib/pitch-coverage'
import { fixtureLibrary, songsTheFixtureLibraryUnlocks } from './golden'

// A Song's melody on piano, then with farts (#359, ADR 0015 rule 3): Song Creator's Piano and
// Farts, and a locked Song's "Play on piano". The page's init script records every buffer started,
// the piano's notes and Farty's sounds alike, and everything the page sends to the speakers,
// through an AudioWorklet between its sounds and the destination. A piano note is told from a fart
// by its samples: they are `pianoNote`'s.
//
// With E2E_EVIDENCE_DIR set, the test also writes what the speakers got while Song Creator played
// the Song on piano, as a WAV with its notes, for `tools/melody-lab/evaluate_piano.py`, and
// screenshots.

/**
 * A buffer started: `start`'s arguments, the AudioContext's clock then, and the buffer's rate,
 * length and first samples.
 */
type BufferStart = { args: number[]; now: number; rate: number; length: number; head: number[] }
/** What the speakers got, one render quantum at a time, by its first frame. */
type Block = { frame: number; samples: Float32Array }

declare global {
  interface Window {
    __bufferStarts: BufferStart[]
    __speakers: { context: AudioContext; blocks: Block[] } | null
  }
}

const evidence = process.env.E2E_EVIDENCE_DIR ? resolve(process.env.E2E_EVIDENCE_DIR) : null

const found = songs.find(s => s.id === 'mary')
if (!found) throw new Error('Mary Had a Little Lamb is in the catalog')
const mary = found
const beat = 60 / mary.bpm
const marySeconds = Math.max(...mary.notes.map(n => (n.start + n.dur) * beat))

test.use({ serviceWorkers: 'block' })

test('Song Creator plays a Song on piano, then with farts, from the same spot', async ({
  page,
  request
}, testInfo) => {
  // `next dev` never shows the Fixture Library's loader.
  const onStagingBuild =
    process.env.E2E_SERVER === 'preview' &&
    (await request.get('/fixtures/recordings/index.json')).ok()
  test.skip(!onStagingBuild, 'The Fixture Library is only in the Staging build')
  test.setTimeout(240_000)
  const out = evidence && join(evidence, testInfo.project.name)
  if (out) mkdirSync(out, { recursive: true })
  expect(songsTheFixtureLibraryUnlocks).toContain(mary)
  const { transposition } = arrangementOf(mary, fixtureLibrary)

  await listenToTheSpeakers(page)
  await page.goto('/profile/')
  await loadTheFixtureLibrary(page)
  await page.getByTestId('unlocked-songs').locator('[data-song="mary"]').getByRole('link').click()
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  const state = page.getByTestId('song-creator-state')
  const play = page.getByTestId('song-creator-play')
  const playOn = page.getByRole('group', { name: 'Play on' })
  const piano = playOn.getByRole('button', { name: 'Piano' })
  const farts = playOn.getByRole('button', { name: 'Farts' })

  // It opens on Farts, playing the Toot.
  await expect(state).toHaveText('Playing', { timeout: 60_000 })
  await expect(farts).toHaveAttribute('aria-pressed', 'true')
  await expect(piano).toHaveAttribute('aria-pressed', 'false')
  await expect(
    page.getByText(`${mary.pitches.length} of your Recordings, one per note`)
  ).toBeVisible()
  for (const control of [piano, farts, play]) await expectTappable(control)
  await play.click()
  await expect(state).toHaveText('Ready')

  // Piano plays every note of the Song in the Toot's key, at its tempo, and nothing of Farty's.
  await piano.click()
  await expect(piano).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText("The Song's notes on piano")).toBeVisible()
  await expect(play).toHaveAccessibleName('Play on piano')
  await forget(page)
  await play.click()
  await expect(state).toHaveText('Playing')
  await expect(play).toHaveAccessibleName('Stop')
  await expect(page.getByTestId('playhead')).toHaveCount(1)
  if (out) await page.screenshot({ path: join(out, 'song-creator-piano.png') })
  // It ends by itself once the last note has rung.
  await expect(state).toHaveText('Ready', { timeout: (marySeconds + 5) * 1000 })
  const whole = await notesStruck(page)
  expect(whole.map(n => n.midi)).toEqual(mary.notes.map(n => n.pitch + transposition))
  whole.forEach((n, i) => {
    expect(n.at - whole[0].at).toBeCloseTo(mary.notes[i].start * beat, 4)
  })
  expect(await fartsStarted(page)).toEqual([])
  if (out) await saveTheSpeakers(page, out, whole[0].at, transposition)

  // Switched to Farts while it plays, the Toot carries on from where the piano was, and the piano
  // stops.
  await forget(page)
  await play.click()
  await expect(state).toHaveText('Playing')
  await page.waitForTimeout(2_000)
  await farts.click()
  await expect(farts).toHaveAttribute('aria-pressed', 'true')
  await expect(state).toHaveText('Playing')
  await expect.poll(async () => (await fartsStarted(page)).length).toBe(1)
  const [when, from] = (await fartsStarted(page))[0]
  expect(when).toBe(0)
  expect(from).toBeGreaterThan(1.8)
  expect(from).toBeLessThan(2.6)
  const struck = (await notesStruck(page)).length
  await page.waitForTimeout(1_000)
  expect(await notesStruck(page)).toHaveLength(struck)

  // And back to Piano, which plays the rest of the Song from there.
  await forget(page)
  await piano.click()
  await expect(state).toHaveText('Playing')
  await expect(state).toHaveText('Ready', { timeout: (marySeconds + 5) * 1000 })
  const rest = await notesStruck(page)
  expect(rest.length).toBeGreaterThan(0)
  expect(rest.length).toBeLessThan(mary.notes.length - 4)
  expect(rest.map(n => n.midi)).toEqual(
    mary.notes.slice(mary.notes.length - rest.length).map(n => n.pitch + transposition)
  )

  // A note tapped plays on piano too.
  await forget(page)
  await tapNote(page.getByTestId('note-view'), page.getByTestId('note 3'))
  await expect.poll(async () => (await notesStruck(page)).length).toBe(1)
  expect((await notesStruck(page))[0].midi).toBe(mary.notes[2].pitch + transposition)
  expect(await fartsStarted(page)).toEqual([])

  // Leaving Song Creator stops it.
  await play.click()
  await expect(state).toHaveText('Playing')
  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await expect(page).toHaveURL(/\/compose\/$/)
  await expectSilenceFromNow(page)
})

test('a locked Song plays on piano from its sheet, and closing the sheet stops it', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const out = evidence && join(evidence, testInfo.project.name)
  if (out) mkdirSync(out, { recursive: true })

  // Before any Recording, every Song is locked.
  await listenToTheSpeakers(page)
  await page.goto('/compose/')
  await page.getByRole('button', { name: mary.title, exact: true }).click()
  const sheet = page.getByRole('dialog', { name: mary.title })
  const piano = sheet.getByTestId('locked-song-piano')
  const record = sheet.getByRole('button', { name: 'Record', exact: true })
  await expect(piano).toHaveText('Play on piano')
  await expectTappable(piano)
  // Right above Record.
  const [pianoBox, recordBox] = await Promise.all([piano.boundingBox(), record.boundingBox()])
  expect((pianoBox?.y ?? 0) + (pianoBox?.height ?? 0)).toBeLessThanOrEqual(recordBox?.y ?? 0)

  // With no farts yet, it plays the Song as written.
  await piano.click()
  await expect(piano).toHaveText('Stop')
  await expect.poll(async () => (await notesStruck(page)).length).toBeGreaterThan(2)
  const first = await notesStruck(page)
  expect(first.map(n => n.midi)).toEqual(mary.notes.slice(0, first.length).map(n => n.pitch))
  if (out) await page.screenshot({ path: join(out, 'locked-song-piano.png') })
  await piano.click()
  await expect(piano).toHaveText('Play on piano')
  await expectSilenceFromNow(page)

  // Closing the sheet while it plays stops it.
  await piano.click()
  await expect(piano).toHaveText('Stop')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()
  await expectSilenceFromNow(page)
})

/**
 * Records, in the page, every buffer started (`__bufferStarts`) and everything the page sends to the
 * speakers (`__speakers`), and skips Welcome and the account step.
 */
async function listenToTheSpeakers(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('pedos.welcomed', '1')
    localStorage.setItem('pedos.accountStep', 'done')
    window.__bufferStarts = []
    window.__speakers = null

    const startBuffer = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (
      this: AudioBufferSourceNode,
      ...args: number[]
    ) {
      const buffer = this.buffer
      window.__bufferStarts.push({
        args,
        now: this.context.currentTime,
        rate: buffer?.sampleRate ?? 0,
        length: buffer?.length ?? 0,
        head: buffer ? Array.from(buffer.getChannelData(0).subarray(0, 256)) : []
      })
      startBuffer.apply(this, args as [number?, number?, number?])
    }

    // Whatever connects to the destination connects to a tap instead, which plays to the
    // destination and to a recorder.
    type Wire = (this: AudioNode, ...args: unknown[]) => unknown
    const connect = AudioNode.prototype.connect as unknown as Wire
    const disconnect = AudioNode.prototype.disconnect as unknown as Wire
    const taps = new WeakMap<BaseAudioContext, GainNode>()
    const throughTap = (node: AudioNode, target: unknown) =>
      target instanceof AudioDestinationNode ? (taps.get(node.context) ?? target) : target
    AudioNode.prototype.connect = function (this: AudioNode, target: unknown, ...rest: unknown[]) {
      const result = connect.call(this, throughTap(this, target), ...rest)
      return target instanceof AudioDestinationNode ? target : result
    } as unknown as typeof AudioNode.prototype.connect
    AudioNode.prototype.disconnect = function (this: AudioNode, ...args: unknown[]) {
      return disconnect.call(
        this,
        ...(args.length > 0 ? [throughTap(this, args[0]), ...args.slice(1)] : [])
      )
    } as unknown as typeof AudioNode.prototype.disconnect

    const recorder = URL.createObjectURL(
      new Blob(
        [
          `registerProcessor('speakers', class extends AudioWorkletProcessor {
            process(inputs) {
              const channel = inputs[0][0]
              this.port.postMessage({ frame: currentFrame, samples: channel ? channel.slice() : new Float32Array(128) })
              return true
            }
          })`
        ],
        { type: 'text/javascript' }
      )
    )
    const Native = window.AudioContext
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options)
        const tap = this.createGain()
        connect.call(tap, this.destination)
        taps.set(this, tap)
        const speakers = { context: this as AudioContext, blocks: [] as Block[] }
        window.__speakers = speakers
        void this.audioWorklet.addModule(recorder).then(() => {
          const node = new AudioWorkletNode(this, 'speakers')
          node.port.onmessage = (event: MessageEvent<Block>) => speakers.blocks.push(event.data)
          connect.call(tap, node)
          // Its output is silence, and keeps it pulled.
          connect.call(node, this.destination)
        })
      }
    }
  })
}

/** Forgets the buffers started so far. */
async function forget(page: Page) {
  await page.evaluate(() => {
    window.__bufferStarts = []
  })
}

/** `pianoNote`'s samples, by sample rate and MIDI note, as they're asked for. */
const pianoNotes = new Map<string, Float32Array>()

/** The piano note whose samples `start`'s buffer holds, or null for one of Farty's sounds. */
function pianoMidiOf(start: BufferStart): number | null {
  for (let midi = 21; midi <= 108; midi++) {
    const key = `${start.rate}:${midi}`
    let samples = pianoNotes.get(key)
    if (!samples) {
      samples = pianoNote(midi, start.rate)
      pianoNotes.set(key, samples)
    }
    if (
      samples.length === start.length &&
      start.head.every((sample, i) => Math.abs(sample - samples[i]) < 1e-6)
    )
      return midi
  }
  return null
}

/** The notes the piano struck since `forget`: when, on the AudioContext's clock, and which. */
async function notesStruck(page: Page): Promise<{ at: number; midi: number }[]> {
  const starts = await page.evaluate(() => window.__bufferStarts)
  return starts.flatMap(start => {
    const midi = pianoMidiOf(start)
    return midi === null ? [] : [{ at: Math.max(start.args[0] ?? 0, start.now), midi }]
  })
}

/** `start`'s arguments for each of Farty's sounds started since `forget`. */
async function fartsStarted(page: Page): Promise<number[][]> {
  const starts = await page.evaluate(() => window.__bufferStarts)
  return starts.filter(start => pianoMidiOf(start) === null).map(start => start.args)
}

/** From 0.15 s on, the speakers get nothing, and nothing more starts. */
async function expectSilenceFromNow(page: Page) {
  const now = await page.evaluate(() => window.__speakers?.context.currentTime ?? 0)
  const started = await page.evaluate(() => window.__bufferStarts.length)
  await page.waitForTimeout(2_000)
  expect(await page.evaluate(() => window.__bufferStarts.length)).toBe(started)
  const peak = await page.evaluate(from => {
    const speakers = window.__speakers
    if (!speakers) return Number.NaN
    const first = Math.round((from + 0.15) * speakers.context.sampleRate)
    let loudest = 0
    let heard = 0
    for (const block of speakers.blocks) {
      if (block.frame < first) continue
      heard += block.samples.length
      for (const sample of block.samples) loudest = Math.max(loudest, Math.abs(sample))
    }
    // A second at least was recorded.
    return heard >= speakers.context.sampleRate ? loudest : Number.NaN
  }, now)
  expect(peak).toBeLessThan(0.001)
}

/**
 * Writes what the speakers got while the piano played the Song from `zero` (on the AudioContext's
 * clock), as a 16-bit WAV at the context's rate, and the Song's notes as written, in the key it was
 * played in, for `evaluate_piano.py`.
 */
async function saveTheSpeakers(page: Page, out: string, zero: number, transposition: number) {
  const from = zero - 0.5
  const to = zero + marySeconds + 1
  const { sampleRate, pcm } = await page.evaluate(
    ({ from, to }) => {
      const speakers = window.__speakers
      if (!speakers) throw new Error('Nothing reached the speakers')
      const rate = speakers.context.sampleRate
      const first = Math.round(from * rate)
      const samples = new Int16Array(Math.round((to - from) * rate))
      for (const block of speakers.blocks) {
        block.samples.forEach((sample, i) => {
          const at = block.frame + i - first
          if (at >= 0 && at < samples.length)
            samples[at] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
        })
      }
      const bytes = new Uint8Array(samples.buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return { sampleRate: rate, pcm: btoa(binary) }
    },
    { from, to }
  )
  const data = Buffer.from(pcm, 'base64')
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  writeFileSync(join(out, 'piano-mary.wav'), Buffer.concat([header, data]))
  writeFileSync(
    join(out, 'piano-mary.json'),
    `${JSON.stringify(
      {
        song: mary.id,
        bpm: mary.bpm,
        transposition,
        // Where the Song's 0 is in the WAV, in seconds.
        zero: zero - from,
        notes: mary.notes.map(n => ({
          midi: n.pitch + transposition,
          start: n.start * beat,
          seconds: Math.max(0.06, n.dur * beat - 0.025)
        }))
      },
      null,
      2
    )}\n`
  )
}

/** Loads the Fixture Library from Profile, then opens Compose with the Songs it unlocks. */
async function loadTheFixtureLibrary(page: Page) {
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
  await page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: 'Compose', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: `Unlocked · ${songsTheFixtureLibraryUnlocks.length}`,
      exact: true
    })
  ).toBeVisible({ timeout: 60_000 })
}

/** Taps the note view where `note` is drawn. The view picks the nearest note. */
async function tapNote(noteView: Locator, note: Locator) {
  const view = await noteView.boundingBox()
  const box = await note.boundingBox()
  if (!view || !box) throw new Error('The note view is not on screen')
  await noteView.click({
    position: { x: box.x - view.x + box.width / 2, y: box.y - view.y + box.height / 2 }
  })
}

/** A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls. */
async function expectTappable(control: Locator) {
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}
