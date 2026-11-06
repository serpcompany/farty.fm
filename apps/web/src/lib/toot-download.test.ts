// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchTootFile, offerTootFile, tootFileName } from './toot-download'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (navigator as Navigator & { standalone?: boolean }).standalone
})

describe('tootFileName', () => {
  it("names the file for the Toot, without what files can't have", () => {
    expect(tootFileName('Twinkle Twinkle')).toBe('Twinkle Twinkle.wav')
    expect(tootFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j.wav')
    expect(tootFileName('  two\n\tlines  ')).toBe('two lines.wav')
    expect(tootFileName('...hidden')).toBe('hidden.wav')
    expect(tootFileName('💨 Toot')).toBe('💨 Toot.wav')
  })

  it('falls back when nothing of the title is left', () => {
    expect(tootFileName('')).toBe('Toot.wav')
    expect(tootFileName(' /// ')).toBe('Toot.wav')
    expect(tootFileName('...')).toBe('Toot.wav')
  })

  it('stops a long title at a whole character', () => {
    const name = tootFileName('💨'.repeat(200))
    expect(name).toBe(`${'💨'.repeat(100)}.wav`)
  })
})

describe('fetchTootFile', () => {
  const answering = (status: number, body: BodyInit | null = null) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status }))
    )

  it('asks for the Toot as the account, and keeps the bytes it gets', async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3])
    answering(200, bytes)
    const fetched = await fetchTootFile('toot-1', 'My Toot', 'account-1')
    const [path, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/toots/toot-1/download/')
    expect(new Headers(init.headers).get('x-pedos-library')).toBe('account-1')
    if (!('file' in fetched)) throw new Error('No file')
    expect(fetched.file.name).toBe('My Toot.wav')
    expect(fetched.file.type).toBe('audio/wav')
    expect(new Uint8Array(await fetched.file.arrayBuffer())).toEqual(bytes)
  })

  it('says why there is no file', async () => {
    answering(402)
    expect(await fetchTootFile('t', 'T', 'a')).toEqual({ error: 'noFullAccess' })
    answering(404)
    expect(await fetchTootFile('t', 'T', 'a')).toEqual({ error: 'notUploaded' })
    answering(500)
    expect(await fetchTootFile('t', 'T', 'a')).toEqual({ error: 'failed' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await fetchTootFile('t', 'T', 'a')).toEqual({ error: 'failed' })
  })
})

describe('offerTootFile', () => {
  const file = new File(['RIFF'], 'My Toot.wav', { type: 'audio/wav' })

  /** Watches for the download link's click, with its name and whether the URL was still good. */
  function watchLink() {
    const clicks: { download: string; href: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicks.push({ download: this.download, href: this.href })
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:made-up')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    return { clicks, revoke }
  }

  function onIPhoneHomeScreen(share: () => Promise<void>) {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    vi.stubGlobal('navigator', Object.assign(navigator, { canShare: () => true, share }))
  }

  it('downloads through a link in a browser, and frees the file only long after', async () => {
    vi.useFakeTimers()
    const { clicks, revoke } = watchLink()
    expect(await offerTootFile(file)).toBe('offered')
    expect(clicks).toEqual([{ download: 'My Toot.wav', href: 'blob:made-up' }])
    expect(document.querySelector('a')).toBeNull()
    vi.advanceTimersByTime(59_000)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(revoke).toHaveBeenCalledWith('blob:made-up')
    vi.useRealTimers()
  })

  it('uses the share sheet from an iPhone Home Screen', async () => {
    const { clicks } = watchLink()
    const share = vi.fn(async () => {})
    onIPhoneHomeScreen(share)
    expect(await offerTootFile(file)).toBe('offered')
    expect(share).toHaveBeenCalledWith({ files: [file] })
    expect(clicks).toEqual([])
  })

  it('asks for a fresh tap when Safari holds the share sheet back', async () => {
    const { clicks } = watchLink()
    onIPhoneHomeScreen(async () => {
      throw new DOMException('Not now', 'NotAllowedError')
    })
    expect(await offerTootFile(file)).toBe('needsTap')
    expect(clicks).toEqual([])
  })

  it('stops when the share sheet is closed', async () => {
    const { clicks } = watchLink()
    onIPhoneHomeScreen(async () => {
      throw new DOMException('Closed', 'AbortError')
    })
    expect(await offerTootFile(file)).toBe('cancelled')
    expect(clicks).toEqual([])
  })

  it('falls back to the link when the share sheet breaks', async () => {
    const { clicks } = watchLink()
    onIPhoneHomeScreen(async () => {
      throw new TypeError('Nope')
    })
    expect(await offerTootFile(file)).toBe('offered')
    expect(clicks).toHaveLength(1)
  })
})
