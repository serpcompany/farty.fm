import { afterEach, describe, expect, it, vi } from 'vitest'

import { handOverFile, tootFileName } from './toot-file'

// A saved Toot's file (#408): its name, and how it reaches the phone. Safari's own behavior isn't
// here: `e2e/toot-download.spec.ts` drives the download, and the PR's tap-through real WebKit.

describe('tootFileName', () => {
  it('names the file after the Toot', () => {
    expect(tootFileName('Twinkle Twinkle')).toBe('Twinkle Twinkle.wav')
    expect(tootFileName('  Für Elise 🎵 ')).toBe('Für Elise 🎵.wav')
    expect(tootFileName('Family 👨‍👩‍👧 toot')).toBe('Family 👨‍👩‍👧 toot.wav')
  })

  it('leaves out what a file name can’t have, and what would make it read wrong', () => {
    expect(tootFileName('AC/DC: Back\\in "Black"?')).toBe('AC DC Back in Black.wav')
    expect(tootFileName('line\nbreak\ttab')).toBe('line break tab.wav')
    expect(tootFileName('evil\u202evaw.exe')).toBe('evil vaw.exe.wav')
    expect(tootFileName('../../etc/passwd')).toBe('etc passwd.wav')
  })

  it('never hides its extension behind a dot, or doubles it', () => {
    expect(tootFileName('.hidden')).toBe('hidden.wav')
    expect(tootFileName('Ends with dots...')).toBe('Ends with dots.wav')
    expect(tootFileName('Already.WAV')).toBe('Already.wav')
    expect(tootFileName('take.wav.')).toBe('take.wav')
  })

  it('is called Toot when its title leaves nothing', () => {
    expect(tootFileName('')).toBe('Toot.wav')
    expect(tootFileName('  ...  ')).toBe('Toot.wav')
    expect(tootFileName('///')).toBe('Toot.wav')
    expect(tootFileName('.wav')).toBe('Toot.wav')
  })

  it('stays short enough for any phone, counting characters, not bytes', () => {
    expect(tootFileName('a'.repeat(200))).toBe(`${'a'.repeat(80)}.wav`)
    expect(tootFileName('🎵'.repeat(200))).toBe(`${'🎵'.repeat(80)}.wav`)
    expect(tootFileName(`${'a'.repeat(79)} b`)).toBe(`${'a'.repeat(79)}.wav`)
  })
})

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36'

const file = new File([new Uint8Array([1, 2, 3])], 'Toot.wav', { type: 'audio/wav' })

/** A browser, with the share sheet answering `share`. Returns what happened in it. */
function aBrowser({
  userAgent,
  homeScreen = false,
  canShare = true,
  share = async () => {}
}: {
  userAgent: string
  homeScreen?: boolean
  canShare?: boolean
  share?: () => Promise<void>
}) {
  const shared = vi.fn(share)
  const link = {
    href: '',
    download: '',
    hidden: false,
    click: vi.fn(),
    remove: vi.fn()
  }
  const appended = vi.fn()
  vi.stubGlobal('navigator', {
    userAgent,
    maxTouchPoints: 5,
    standalone: homeScreen,
    canShare: () => canShare,
    share: shared
  })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { createElement: () => link, body: { appendChild: appended } })
  const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:made-up')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { shared, link, appended, createObjectUrl, revoke }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('handOverFile', () => {
  it('downloads the very file, named, on Android', async () => {
    const browser = aBrowser({ userAgent: ANDROID })
    expect(await handOverFile(file)).toBe('downloading')
    expect(browser.shared).not.toHaveBeenCalled()
    expect(browser.createObjectUrl).toHaveBeenCalledWith(file)
    expect(browser.link).toMatchObject({ href: 'blob:made-up', download: 'Toot.wav' })
    expect(browser.link.click).toHaveBeenCalledOnce()
    expect(browser.link.remove).toHaveBeenCalledOnce()
  })

  it('downloads in Safari on iPhone, where Safari asks and keeps it in Files', async () => {
    const browser = aBrowser({ userAgent: IPHONE })
    expect(await handOverFile(file)).toBe('downloading')
    expect(browser.shared).not.toHaveBeenCalled()
    expect(browser.link.click).toHaveBeenCalledOnce()
  })

  it('downloads from a Home Screen app on Android, which keeps Chrome’s downloads', async () => {
    const browser = aBrowser({ userAgent: ANDROID, homeScreen: true })
    expect(await handOverFile(file)).toBe('downloading')
    expect(browser.shared).not.toHaveBeenCalled()
  })

  it('keeps the address until long after Safari’s question could be answered', async () => {
    vi.useFakeTimers()
    const browser = aBrowser({ userAgent: IPHONE })
    await handOverFile(file)
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(browser.revoke).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(browser.revoke).toHaveBeenCalledWith('blob:made-up')
  })

  it('goes through the share sheet from a Home Screen app on iPhone, with the file alone', async () => {
    const browser = aBrowser({ userAgent: IPHONE, homeScreen: true })
    expect(await handOverFile(file)).toBe('shared')
    expect(browser.shared).toHaveBeenCalledWith({ files: [file] })
    expect(browser.link.click).not.toHaveBeenCalled()
  })

  it('does nothing more when the share sheet is closed', async () => {
    const browser = aBrowser({
      userAgent: IPHONE,
      homeScreen: true,
      share: () => Promise.reject(new DOMException('closed', 'AbortError'))
    })
    expect(await handOverFile(file)).toBe('cancelled')
    expect(browser.link.click).not.toHaveBeenCalled()
  })

  it('asks for a fresh tap when the browser wants one, and only once', async () => {
    const browser = aBrowser({
      userAgent: IPHONE,
      homeScreen: true,
      share: () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'))
    })
    expect(await handOverFile(file)).toBe('needsTap')
    expect(browser.link.click).not.toHaveBeenCalled()
    // Refused from a tap too: it never asks twice, and a Home Screen app has no downloads to try.
    expect(await handOverFile(file, true)).toBe('failed')
    expect(browser.link.click).not.toHaveBeenCalled()
  })

  it('tries the download when the share sheet can’t take the file', async () => {
    const cannot = aBrowser({ userAgent: IPHONE, homeScreen: true, canShare: false })
    expect(await handOverFile(file)).toBe('downloading')
    expect(cannot.shared).not.toHaveBeenCalled()
    expect(cannot.link.click).toHaveBeenCalledOnce()
  })

  it('says it failed when the share sheet fails, rather than pretending a download', async () => {
    const browser = aBrowser({
      userAgent: IPHONE,
      homeScreen: true,
      share: () => Promise.reject(new DOMException('failed', 'DataError'))
    })
    expect(await handOverFile(file)).toBe('failed')
    expect(browser.link.click).not.toHaveBeenCalled()
  })
})
