import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { songVersion } from '@/lib/song-report'
import { ReportSongSheet } from './report-song-sheet'

// The report sheet (#358) in a DOM: Send waits for a reason, sends the reason, the note and the
// notes the Song played, then thanks; a report that can't be sent keeps what was picked and typed;
// and each opening starts a new report. The server is `fetch`, answering as the route does.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const [song] = songIndex

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise(r => setTimeout(r, 0)))
}

async function open(onClose = () => {}, shown: typeof song | null = song) {
  await act(async () => root?.render(<ReportSongSheet song={shown} onClose={onClose} />))
  await settle()
}

const sheet = () => document.querySelector<HTMLElement>('[data-testid="report-song-sheet"]')
const radio = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    item => item.closest('label')?.textContent === name
  )
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    item => item.textContent?.trim() === name
  )
const textarea = () => document.querySelector<HTMLTextAreaElement>('textarea')
const alertText = () => document.querySelector('[role="alert"]')?.textContent

async function pick(name: string) {
  const item = radio(name)
  if (!item) throw new Error(`No reason ${name}`)
  await act(async () => item.click())
}

async function type(text: string) {
  const field = textarea()
  if (!field) throw new Error('No note')
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function send() {
  await act(async () => button('Send')?.click())
  await settle()
}

describe('The report sheet', () => {
  it('sends the reason, the note and the notes it played once a reason is picked, then thanks', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    const onClose = vi.fn()
    await open(onClose)
    expect(sheet()?.textContent).toContain('Report a problem')
    expect(sheet()?.textContent).toContain(song.title)
    expect(button('Send')?.disabled).toBe(true)

    await pick("Doesn't sound like this Song")
    await type('Bar 3')
    expect(sheet()?.textContent).toContain('5/500')
    expect(button('Send')?.disabled).toBe(false)
    await send()

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`/api/songs/${song.id}/report/`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      reason: 'wrong_sound',
      note: 'Bar 3',
      version: songVersion(song)
    })
    expect(sheet()?.textContent).toContain("Thanks, we'll take a look.")
    expect(sheet()?.textContent).toContain(song.title)
    expect(button('Send')).toBeUndefined()

    await act(async () => button('Done')?.click())
    expect(onClose).toHaveBeenCalled()
  })

  it("keeps the reason and the note when the report can't be sent", async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ error: 'too_many_reports' }, { status: 429 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await open()
    await pick('Missing or wrong notes')
    await type('The last bar')

    await send()
    expect(alertText()).toBe('Too many reports right now. Try again later.')
    expect(radio('Missing or wrong notes')?.getAttribute('aria-checked')).toBe('true')
    expect(textarea()?.value).toBe('The last bar')
    expect(button('Send')?.disabled).toBe(false)

    await send()
    expect(alertText()).toBe("Couldn't send the report. Check your connection and try again.")
    expect(textarea()?.value).toBe('The last bar')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('starts a new report each time it opens', async () => {
    await open()
    await pick('Wrong title or composer')
    await type('Hi')
    await open(undefined, null)
    await open()
    expect(document.querySelector('[role="radio"][aria-checked="true"]')).toBeNull()
    expect(textarea()?.value).toBe('')
    expect(button('Send')?.disabled).toBe(true)
  })
})
