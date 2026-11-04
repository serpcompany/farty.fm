import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { pianoNote } from '../src/components/pedos/piano-keys'
import { pianoSchedule } from '../src/components/pedos/piano-preview'
import { songs } from '../src/lib/catalog/songs.generated'
import { noteName } from '../src/lib/pitch'
import { newEmail, signInByApi } from './account'
import { songsTheFixtureLibraryUnlocks } from './golden'
import { payToSave } from './pay'

// Fart Choices (#360) on the Staging build, with the whole Fixture Library loaded: a note's fart
// swapped from the note in Song Creator, heard, saved, and played back from Toots with the fart
// that was swapped in; kept across a reload and reset; then a Song's only fart for a note left
// out, which locks it, and Reset to automatic, which unlocks it again.
//
// With E2E_EVIDENCE_DIR set, it also takes the PR's screenshots there.

/** Every start of an `AudioBufferSourceNode`, as the page's init script records it. */
type Start = { duration: number; peak: number; args: number[] }
/** A start also holds the buffer's rate and first samples, to tell a piano note by. */
type HeardStart = Start & { rate: number; head: number[] }

declare global {
  interface Window {
    __starts: Start[]
  }
}

const evidence = process.env.E2E_EVIDENCE_DIR ? resolve(process.env.E2E_EVIDENCE_DIR) : null
const twinkle = songs.find(s => s.id === 'twinkle')
const mary = songs.find(s => s.id === 'mary')

test.beforeEach(async ({ request }) => {
  const onStagingBuild =
    process.env.E2E_SERVER === 'preview' &&
    (await request.get('/fixtures/recordings/index.json')).ok()
  test.skip(
    !onStagingBuild,
    'The Fixture Library is only in the Staging build (pnpm build:staging)'
  )
})

test.use({ serviceWorkers: 'block' })

test('swaps a note’s fart, plays it, saves it, and the saved Toot plays that fart', async ({
  page
}, testInfo) => {
  test.setTimeout(300_000)
  if (!twinkle || !mary) throw new Error('the catalog has Twinkle and Mary')
  expect(songsTheFixtureLibraryUnlocks).toContain(twinkle)
  expect(songsTheFixtureLibraryUnlocks).toContain(mary)
  const out = evidence && join(evidence, testInfo.project.name)
  if (out) mkdirSync(out, { recursive: true })

  await listenToThePage(page)
  await page.goto('/profile/')
  // Saving a Toot needs an account.
  await signInByApi(page, newEmail(testInfo, 'fart-choices'))
  await page.reload()
  await loadTheFixtureLibrary(page)

  const state = page.getByTestId('song-creator-state')
  const play = page.getByTestId('song-creator-play')
  const sheet = page.getByTestId('fart-sheet')
  const used = page.getByTestId('recording-used')
  const changed = page.getByTestId('fart-change')
  const lowest = twinkle.pitches[0]
  // Twinkle's first note is its lowest pitch.
  expect(twinkle.notes[0].pitch).toBe(lowest)
  // The Recordings' names, before and after the swap, and the note's name.
  let before = ''
  let swappedIn = ''
  let note = ''

  await test.step('swap the first note’s fart from the note', async () => {
    await page
      .getByTestId('unlocked-songs')
      .locator('[data-song="twinkle"]')
      .getByRole('link')
      .click()
    await expect(page).toHaveURL(/\/compose\/twinkle\/$/)
    await expect(state).toHaveText('Playing', { timeout: 60_000 })
    await play.click()
    await expect(state).toHaveText('Ready')

    await tapNote(page.getByTestId('note-view'), page.getByTestId('note 1'))
    const caption = page.getByTestId('note-caption')
    await expect(caption).toHaveText(/^[A-G]♯?\d · Recording \d+ \([A-G]♯?\d\) · \d+\.\d s$/)
    note = ((await caption.textContent()) ?? '').split(' · ')[0]
    before = /Recording \d+/.exec((await caption.textContent()) ?? '')?.[0] ?? ''
    const changeFart = page.getByRole('button', { name: 'Change fart' })
    await expectTappable(changeFart)
    await changeFart.click()

    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: note, exact: true })).toBeVisible()
    const options = sheet.getByTestId('fart-option')
    // Each fart: its name, its nearest note, how far that is from the note, and its length.
    await expect(options.first()).toBeVisible()
    for (const option of await options.all()) {
      await expect(option.getByRole('button').first()).toHaveAccessibleName(
        /^Recording \d+, [A-G]♯?\d · (on the note|\d+ semitones? (low|high)|an octave( and \d)? (low|high)) · \d+\.\d s/
      )
    }
    // The fart in use first, as Farty's pick.
    await expect(options.first()).toContainText(before)
    await expect(options.first()).toContainText("Farty's pick")
    await expect(options.first()).toContainText('In use')
    const swap = options.filter({ has: page.getByRole('button', { name: 'Swap' }) }).first()
    swappedIn = /Recording \d+/.exec((await swap.textContent()) ?? '')?.[0] ?? ''
    expect(swappedIn).not.toBe('')
    expect(swappedIn).not.toBe(before)
    await expectTappable(swap.getByRole('button', { name: 'Swap' }))
    // "Hear <note> on piano" plays that note on piano, the key a tapped key plays, once.
    const hear = sheet.getByRole('button', { name: `Hear ${note} on piano` })
    await expectTappable(hear)
    await page.evaluate(() => (window.__starts = []))
    await hear.click()
    expect(isPianoNote(await lastStart(page), midiOf(note))).toBe(true)
    // Tapping a fart plays it alone, raw.
    await page.evaluate(() => (window.__starts = []))
    await swap.getByRole('button').first().click()
    expect((await lastStart(page)).peak).toBeGreaterThan(0.01)
    if (out) await page.screenshot({ path: join(out, 'fart-sheet.png') })

    await swap.getByRole('button', { name: 'Swap' }).click()
    await expect(sheet).toBeHidden()
    await expect(changed).toHaveText(new RegExp(`^${note} now uses ${swappedIn}\\.`))
    // Made again with the fart swapped in, and it waits for a tap.
    await expect(state).toHaveText('Ready', { timeout: 60_000 })
    await expect(caption).toHaveText(new RegExp(`^${note} · ${swappedIn} \\(`))
    const row = used.filter({
      has: page.getByRole('button', { name: new RegExp(`^${swappedIn},`) })
    })
    await expect(row).toContainText('Your pick')
    await expect(row).toContainText(`plays ${note}`)
    if (out) await page.screenshot({ path: join(out, 'swapped-note.png') })
  })

  await test.step('play it and save it', async () => {
    await page.evaluate(() => (window.__starts = []))
    await play.click()
    await expect(state).toHaveText('Playing')
    const whole = await lastStart(page)
    expect(whole.duration).toBeGreaterThan(5)
    expect(whole.peak).toBeGreaterThan(0.05)
    await play.click()
    await payToSave(page)
  })

  await test.step('the saved Toot keeps the fart swapped in, and plays it', async () => {
    const recordings = await readAll<{ id: string; number: number; name?: string }>(
      page,
      'recordings'
    )
    const id = recordings.find(r => (r.name?.trim() || `Recording ${r.number}`) === swappedIn)?.id
    expect(id).toBeDefined()
    const toots = await readAll<{
      songId: string
      arrangement: { recordingForPitch: Record<number, string> }
    }>(page, 'toots')
    const saved = toots.filter(t => t.songId === 'twinkle')
    expect(saved).toHaveLength(1)
    expect(saved[0].arrangement.recordingForPitch[lowest]).toBe(id)
    // The Song's Fart Choices, by Song id.
    const choices = await readOne<{ preferred: Record<number, string> }>(
      page,
      'fartChoices',
      'twinkle'
    )
    expect(choices?.preferred[lowest]).toBe(id)

    // From Toots, it lists the fart swapped in for the note, and plays its own audio, with no
    // way to change a fart.
    await page.goto('/toots/')
    await page.getByTestId('toot-row').first().getByRole('link').click()
    await expect(page).toHaveURL(/\/toots\/toot\/\?id=[\w-]+$/)
    await expect(state).toHaveText('Ready', { timeout: 60_000 })
    await expect(
      used.filter({ has: page.getByRole('button', { name: new RegExp(`^${swappedIn},`) }) })
    ).toContainText(`plays ${note}`)
    await expect(page.getByRole('button', { name: /^Change the fart for / })).toHaveCount(0)
    await page.evaluate(() => (window.__starts = []))
    await tapNote(page.getByTestId('note-view'), page.getByTestId('note 1'))
    await expect(page.getByTestId('note-caption')).toHaveText(
      new RegExp(`^${note} · ${swappedIn} \\(`)
    )
    await expect(page.getByRole('button', { name: 'Change fart' })).toHaveCount(0)
    expect((await lastStart(page)).peak).toBeGreaterThan(0.01)
    await play.click()
    await expect(state).toHaveText('Playing')
    const heard = await lastStart(page)
    expect(heard.duration).toBeGreaterThan(5)
    expect(heard.peak).toBeGreaterThan(0.05)
    await play.click()
  })

  await test.step('the swap is kept across a reload, and Reset to automatic undoes it', async () => {
    await page.goto('/compose/twinkle/')
    const pill = page.getByRole('button', { name: `Change the fart for ${note}` })
    const row = used.filter({ has: pill })
    await expect(row.getByRole('button', { name: new RegExp(`^${swappedIn},`) })).toBeVisible({
      timeout: 60_000
    })
    await expect(row).toContainText('Your pick')
    await expectTappable(pill)
    await pill.click()
    await expect(sheet.getByTestId('fart-option').first()).toContainText('Your pick')
    await sheet.getByRole('button', { name: 'Reset to automatic' }).click()
    await expect(sheet).toBeHidden()
    await expect(changed).toHaveText(new RegExp(`^${note} is back to Farty's pick\\.`))
    await expect(state).toHaveText('Ready', { timeout: 60_000 })
    await expect(row.getByRole('button', { name: new RegExp(`^${before},`) })).toBeVisible()
    await expect(row).not.toContainText('Your pick')
    // Nothing left changed, so the Song has no Fart Choices.
    await expect
      .poll(() => readOne(page, 'fartChoices', 'twinkle'), { timeout: 10_000 })
      .toBeUndefined()
  })

  await test.step('leaving out a note’s only fart locks the Song until Reset', async () => {
    await page.goto('/compose/mary/')
    // Mary's first row: its first pitch, whose only fart in the Fixture Library is the one the
    // reference's golden case leaves out (fixtures/golden/choices.json).
    const pill = used.first().getByRole('button', { name: /^Change the fart for / })
    await expect(pill).toBeVisible({ timeout: 60_000 })
    const gapNote = ((await pill.getAttribute('aria-label')) ?? '').replace(
      'Change the fart for ',
      ''
    )
    await pill.click()
    await expect(sheet.getByRole('heading', { name: gapNote, exact: true })).toBeVisible()
    await expect(sheet.getByTestId('only-fart')).toBeVisible()
    const inUse = /Recording \d+/.exec(
      (await sheet.getByTestId('fart-option').first().textContent()) ?? ''
    )?.[0]
    await sheet.getByRole('button', { name: "Don't use this fart in this Song" }).click()
    await expect(sheet).toBeHidden()

    const lock = page.getByTestId('lock-card')
    await expect(lock).toBeVisible({ timeout: 60_000 })
    await expect(state).toHaveText('Locked')
    await expect(changed).toHaveText(
      new RegExp(`^${inUse} is left out of this Song\\. ${gapNote} has no fart\\.`)
    )
    await expect(lock).toContainText(`Needs a fart near ${gapNote}`)
    await expect(page.getByRole('button', { name: /^Save to Toots/ })).toHaveCount(0)
    // Its notes, drawn as gaps, and its row.
    await expect(page.locator('[data-gap]')).toHaveCount(
      mary.notes.filter(n => n.pitch === mary.pitches[0]).length
    )
    await expect(used.first()).toContainText('No fart')
    await expect(used.first()).toContainText(`Needs a fart near ${gapNote}`)
    await expect(play).toBeDisabled()
    const reset = lock.getByRole('button', { name: 'Reset to automatic' })
    await expectTappable(reset)
    await expectTappable(lock.getByRole('button', { name: 'Record' }))
    if (out) await page.screenshot({ path: join(out, 'gap-lock-card.png') })

    // Piano still plays the whole Song, the left-out pitch's notes too (#359, #360's Option A).
    const playOn = page.getByRole('group', { name: 'Play on' })
    await playOn.getByRole('button', { name: 'Piano' }).click()
    await expect(state).toHaveText('Ready')
    await expect(play).toHaveAccessibleName('Play on piano')
    await expect(play).toBeEnabled()
    await page.evaluate(() => (window.__starts = []))
    await play.click()
    await expect(state).toHaveText('Playing')
    // The first note is struck at the Song's first pitch in the key the farts would play it in:
    // the left-out pitch is Mary's first, so that key is the gap note's less that pitch.
    await expect.poll(() => page.evaluate(() => window.__starts.length)).toBeGreaterThan(0)
    const first = await page.evaluate(() => window.__starts[0])
    const transposition = midiOf(gapNote) - mary.pitches[0]
    const expected = pianoSchedule(mary, transposition)[0].midi
    expect(isPianoNote(first, expected)).toBe(true)
    expect(isPianoNote(first, expected + 1)).toBe(false)
    if (out) await page.screenshot({ path: join(out, 'gap-piano.png') })
    const marySeconds = Math.max(...mary.notes.map(n => n.start + n.dur)) * (60 / mary.bpm)
    await expect(state).toHaveText('Ready', { timeout: (marySeconds + 5) * 1000 })
    // One piano note struck per note of the Song, and no fart.
    expect(await page.evaluate(() => window.__starts.length)).toBe(mary.notes.length)
    await playOn.getByRole('button', { name: 'Farts' }).click()
    await expect(state).toHaveText('Locked')
    await expect(play).toBeDisabled()

    await reset.click()
    await expect(changed).toHaveText("Every note is back to Farty's pick.")
    await expect(state).toHaveText('Ready', { timeout: 60_000 })
    await expect(lock).toHaveCount(0)
    await expect(page.locator('[data-gap]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Save to Toots/ })).toBeVisible()
  })
})

/** Records each sound the page starts (`__starts`), and skips the Welcome and the account step. */
async function listenToThePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('pedos.welcomed', '1')
    localStorage.setItem('pedos.accountStep', 'done')
    // Chrome may offer to install Farty, and the offer would cover Save.
    localStorage.setItem('pedos.installOffered', '1')
    window.__starts = []
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
      let peak = 0
      for (const sample of this.buffer?.getChannelData(0) ?? [])
        peak = Math.max(peak, Math.abs(sample))
      const heard: HeardStart = {
        duration: this.buffer?.duration ?? 0,
        peak,
        args: args as number[],
        rate: this.buffer?.sampleRate ?? 0,
        head: Array.from(this.buffer?.getChannelData(0).subarray(0, 256) ?? [])
      }
      window.__starts.push(heard)
      return start.apply(this, args)
    }
  })
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

/** The page's latest sound, once it has started one since the last call. */
async function lastStart(page: Page): Promise<Start> {
  await expect.poll(() => page.evaluate(() => window.__starts.length)).toBeGreaterThan(0)
  return page.evaluate(() => {
    const start = window.__starts[window.__starts.length - 1]
    window.__starts = []
    return start
  })
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

/** Every record in one of the `pedos` IndexedDB database's stores. */
async function readAll<T>(page: Page, store: string): Promise<T[]> {
  return (await readPedos(page, store, null)) as T[]
}

/** The record under `key` in one of the `pedos` database's stores, or undefined. */
async function readOne<T>(page: Page, store: string, key: string): Promise<T | undefined> {
  return (await readPedos(page, store, key)) as T | undefined
}

async function readPedos(page: Page, store: string, key: string | null): Promise<unknown> {
  return page.evaluate(
    async ({ store, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('pedos')
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      const records = db.transaction(store).objectStore(store)
      const found = await new Promise<unknown>((resolve, reject) => {
        const r = key === null ? records.getAll() : records.get(key)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      db.close()
      return found
    },
    { store, key }
  )
}

/** A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls. */
async function expectTappable(control: Locator) {
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}

/** The MIDI note a name such as C♯3 stands for. */
function midiOf(name: string): number {
  for (let midi = 0; midi < 128; midi++) if (noteName(midi) === name) return midi
  throw new Error(`${name} is not a note`)
}

/** Whether a started buffer is `pianoNote(midi)`: its first samples are. */
function isPianoNote(heard: Start, midi: number): boolean {
  const start = heard as HeardStart
  const samples = pianoNote(midi, start.rate)
  return start.head.length > 0 && start.head.every((s, i) => Math.abs(s - samples[i]) < 1e-6)
}
