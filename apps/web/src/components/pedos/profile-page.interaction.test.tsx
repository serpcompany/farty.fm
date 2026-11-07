import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HeroRoll } from './profile-hero'
import type { ProfileShare } from './profile-share-row'

// A profile page in a DOM, signed in as someone else (#319, #448): the friend control when the
// friend state can't be read, the banner of the newest Toot's roll and its Play, the picture, the
// Toots and Recordings tabs, and each row, which plays only its own audio and never says where a
// fart was made. The server is `fetch`, answering as the routes do; the player is a fake that
// records what it's asked to play.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const heard = vi.hoisted(() => ({
  /** Where the audio clock says the sound playing is, in seconds. */
  position: null as number | null,
  plays: [] as {
    key: string
    wav: () => Promise<ArrayBuffer>
    segment: { start: number; end: number } | null
    onEnded: () => void
  }[]
}))

vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedIn', id: 'userbob' } })
}))
vi.mock('@/lib/audio/player', () => ({
  play: async (
    key: string,
    wav: () => Promise<ArrayBuffer>,
    segment: { start: number; end: number } | null,
    onEnded: () => void
  ) => {
    heard.plays.push({ key, wav, segment, onEnded })
  },
  playbackPosition: () => heard.position,
  stopPlayback: () => heard.plays.at(-1)?.onEnded()
}))

let root: Root | null = null
let container: HTMLDivElement

const now = Date.now()

const toot: ProfileShare = {
  kind: 'toots',
  path: '/@alice/t/tttttttttttt/',
  name: 'Twinkle for Mum',
  detail: 'Sound Pad',
  sharedAt: now,
  length: '0:18',
  part: { startSeconds: 0, endSeconds: 18 },
  levels: []
}

const recording: ProfileShare = {
  kind: 'recordings',
  path: '/@alice/r/rrrrrrrrrrrr/',
  name: 'Recording 1',
  detail: 'E3',
  sharedAt: now,
  length: '1.1 s',
  part: { startSeconds: 0, endSeconds: 1.1 },
  levels: [0.2, 1, 0.5]
}

/** The roll of `toot`: three notes, of which the fart at 62 was left out. */
const hero: HeroRoll = {
  path: toot.path,
  song: {
    bpm: 120,
    length_beats: 4,
    pitches: [60, 62],
    notes: [
      { start: 0, dur: 1, pitch: 60 },
      { start: 1, dur: 1, pitch: 62 },
      { start: 2, dur: 2, pitch: 60 }
    ]
  },
  catalogSong: null,
  played: [60]
}

/**
 * The routes: the friend state, each Toot's bars (`toot`'s, `hero`'s), and any audio.
 * Each fetch is kept in `fetched`.
 */
function server(friend: Response | 'offline' = Response.json({ state: 'none' })) {
  const fetched: string[] = []
  const answers = [friend]
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    fetched.push(url)
    if (url === '/api/friends/alice/') {
      const next = answers.shift() ?? Response.json({ state: 'none' })
      if (next === 'offline') throw new TypeError('Failed to fetch')
      return next
    }
    if (url.endsWith('/row/')) return Response.json({ levels: [0.1, 0.9, 0.4, 0.7] })
    return new Response(new ArrayBuffer(8))
  })
  return fetched
}

async function render(props: { items?: ProfileShare[]; hero?: HeroRoll | null } = {}) {
  const { ProfilePage } = await import('./profile-page')
  await act(async () =>
    root?.render(<ProfilePage handle="alice" items={props.items ?? []} hero={props.hero ?? null} />)
  )
}

/** Lets the routes' answers land. */
const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })

const buttons = () => [...container.querySelectorAll('button')]
const button = (name: string) =>
  buttons().find(each => (each.getAttribute('aria-label') ?? each.textContent) === name)
const retry = () => buttons().find(each => each.textContent === 'Retry')
const heroText = () => container.querySelector('[data-testid="profile-hero"]')?.textContent
const rows = () => [...container.querySelectorAll('[data-testid="profile-shared-item"]')]
const tab = (name: string) =>
  [...container.querySelectorAll('[role="tab"]')].find(each => each.textContent === name)

/** Each row's text in `testid`, in order. */
const rowText = (testid: string) =>
  rows().map(row => row.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null)

/** happy-dom lays nothing out: each element `width` by `height` pixels. */
function laidOut(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
}

beforeEach(() => {
  heard.plays.length = 0
  heard.position = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('The friend control when the friend state can’t be read', () => {
  it('says so with Retry, and Retry reads it again', async () => {
    const fetched = server('offline')
    await render()
    expect(container.textContent).toContain("Can't reach your friends right now.")
    expect(container.textContent).not.toContain('Add friend')

    await act(async () => retry()?.click())
    expect(fetched.filter(url => url === '/api/friends/alice/')).toHaveLength(2)
    expect(container.textContent).not.toContain("Can't reach your friends right now.")
    expect(retry()).toBeUndefined()
    expect(container.textContent).toContain('Add friend')
  })

  it('says so when the server refuses the session', async () => {
    server(Response.json({ error: 'unauthorized' }, { status: 401 }))
    await render()
    expect(container.textContent).toContain("Can't reach your friends right now.")
    expect(retry()).toBeDefined()
  })
})

describe('The hero (#448)', () => {
  it('with a shared Toot: its roll, the picture, the Handle, the newest Toot, Play and Add friend', async () => {
    // happy-dom lays nothing out.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80)
    server()
    await render({ items: [toot, recording], hero })

    const banner = container.querySelector('[data-testid="profile-banner"]')
    const notes = [...(banner?.querySelectorAll('rect') ?? [])]
    expect(notes).toHaveLength(3)
    // The note no fart plays is hollow, as on the Toot's own page.
    expect(notes.map(note => note.getAttribute('fill') === 'none')).toEqual([false, true, false])

    const picture = container.querySelector('[data-testid="profile-picture"]')
    expect(picture?.getAttribute('aria-label')).toBe('Picture for @alice')
    expect(picture?.textContent).toBe('A')
    expect(container.querySelector('h1')?.textContent).toBe('@alice')
    expect(heroText()).toContain('Newest Toot: Twinkle for Mum · 0:18')
    expect(button('Add friend')).toBeDefined()
    expect(button('Report')).toBeDefined()

    // Play plays the Toot's own audio, whole, and its row shows it playing.
    await act(async () =>
      container.querySelector<HTMLElement>('[data-testid="profile-hero-play"]')?.click()
    )
    const played = heard.plays.at(-1)
    expect(played?.key).toBe('shared:/@alice/t/tttttttttttt/audio/')
    expect(played?.segment).toBeNull()
    expect(container.querySelector('[data-testid="profile-hero-play"]')?.textContent).toBe('Stop')
    expect(rows()[0].querySelector('button')?.getAttribute('aria-label')).toBe(
      'Stop Twinkle for Mum'
    )
  })

  it('with no shared Toot: no banner and no Play, only the picture, the Handle and Add friend', async () => {
    server()
    await render({ items: [recording] })
    expect(container.querySelector('[data-testid="profile-banner"]')).toBeNull()
    expect(container.querySelector('[data-testid="profile-hero-play"]')).toBeNull()
    expect(heroText()).not.toContain('Newest Toot')
    expect(container.querySelector('[data-testid="profile-picture"]')?.textContent).toBe('A')
    expect(container.querySelector('h1')?.textContent).toBe('@alice')
    expect(button('Add friend')).toBeDefined()
  })

  it('draws the waveform when the Toot’s Song isn’t in Farty any more', async () => {
    const fetched = server()
    await render({ items: [toot], hero: { ...hero, song: null } })
    await settle()
    expect(fetched).toContain('/@alice/t/tttttttttttt/row/')
    const banner = container.querySelector('[data-testid="profile-banner"]')
    expect(banner?.querySelectorAll('rect')).toHaveLength(0)
    expect(banner?.querySelectorAll('span')).toHaveLength(4)
  })

  it('on your own page: the same hero and tabs, with its note in place of Add friend, and no Report', async () => {
    server(Response.json({ state: 'own' }))
    await render({ items: [toot, recording], hero })
    await settle()
    expect(container.querySelector('[data-testid="profile-banner"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="profile-hero-play"]')).not.toBeNull()
    expect(heroText()).toContain("This is your page. It lists only what you've shared.")
    expect(button('Add friend')).toBeUndefined()
    expect(tab('Toots')?.getAttribute('aria-selected')).toBe('true')
    expect(button('Report')).toBeUndefined()
  })

  it('makes the picture from the Handle’s first letter or digit', async () => {
    const { pictureLetter } = await import('./profile-hero')
    expect(pictureLetter('alice')).toBe('A')
    expect(pictureLetter('_bob')).toBe('B')
    expect(pictureLetter('9lives')).toBe('9')
    expect(pictureLetter('___')).toBe('_')
  })
})

describe('The tabs (#448)', () => {
  it('opens on Toots, lists each kind under its own tab, and the arrow keys move between them', async () => {
    server()
    await render({ items: [toot, recording], hero })
    expect(tab('Toots')?.getAttribute('aria-selected')).toBe('true')
    expect(tab('Recordings')?.getAttribute('aria-selected')).toBe('false')
    expect(rows().map(row => row.querySelector('a')?.textContent)).toEqual(['Twinkle for Mum'])

    await act(async () => (tab('Recordings') as HTMLElement).click())
    expect(tab('Recordings')?.getAttribute('aria-selected')).toBe('true')
    expect(rows().map(row => row.querySelector('a')?.textContent)).toEqual(['Recording 1'])

    await act(async () =>
      tab('Recordings')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      )
    )
    expect(tab('Toots')?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('Toots'))
  })

  it('opens on Toots even when only Recordings are shared, and says when a tab has none', async () => {
    server()
    await render({ items: [recording] })
    expect(tab('Toots')?.getAttribute('aria-selected')).toBe('true')
    expect(rows()).toHaveLength(0)
    expect(container.textContent).toContain('No Toots shared yet.')
    await act(async () => (tab('Recordings') as HTMLElement).click())
    expect(rows().map(row => row.querySelector('a')?.textContent)).toEqual(['Recording 1'])
  })

  it('has no tabs with nothing shared', async () => {
    server()
    await render()
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    expect(container.textContent).toContain('Nothing shared yet.')
  })
})

describe('A row (#346, #448)', () => {
  it('a Toot’s: the Handle over its name, as SoundCloud’s uploader, its day and Song, its length, its own page and its own audio, from a spot too', async () => {
    const fetched = server()
    await render({ items: [toot, recording], hero })
    const [row] = rows()
    expect(row.querySelector('a')?.textContent).toBe('Twinkle for Mum')
    // Its own shared page, with its whole roll and each fart (#445). Next's Link drops the
    // trailing slash here, outside a build with `trailingSlash`.
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/@alice/t/tttttttttttt')
    expect(rowText('profile-shared-byline')).toEqual(['@alice'])
    expect(rowText('profile-shared-date')).toEqual(['Today'])
    expect(rowText('profile-shared-tag')).toEqual(['Sound Pad'])
    expect(rowText('profile-shared-length')).toEqual(['0:18'])
    expect(rowText('profile-shared-time')).toEqual([null])

    await act(async () => row.querySelector('button')?.click())
    const [whole] = heard.plays.slice(-1)
    expect(whole.key).toBe('shared:/@alice/t/tttttttttttt/audio/')
    expect(whole.segment).toBeNull()
    await whole.wav()
    expect(fetched).toContain('/@alice/t/tttttttttttt/audio/')

    // The arrow keys play from a twelfth further on.
    const waveform = row.querySelector<HTMLElement>('[data-testid="replay-waveform"]')
    expect(waveform?.getAttribute('aria-label')).toBe('Play Twinkle for Mum from a spot')
    await act(async () =>
      waveform?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    )
    expect(heard.plays.at(-1)?.segment).toEqual({ start: 1.5, end: 18 })
  })

  it('a Recording’s: Play at its left, no picture, its note as its tag, the Handle, its day, length and own bars', async () => {
    server()
    await render({ items: [recording] })
    await act(async () => (tab('Recordings') as HTMLElement).click())
    const [row] = rows()
    expect(row.querySelector('a')?.textContent).toBe('Recording 1')
    // No square picture (the owner, #451): Play comes first in the row.
    expect(row.querySelector('[data-testid="profile-shared-art"]')).toBeNull()
    expect(row.firstElementChild?.getAttribute('aria-label')).toBe('Play Recording 1')
    expect(rowText('profile-shared-byline')).toEqual(['@alice'])
    expect(rowText('profile-shared-date')).toEqual(['Today'])
    expect(rowText('profile-shared-tag')).toEqual(['E3'])
    expect(rowText('profile-shared-length')).toEqual(['1.1 s'])
    const bars = [...(row.querySelector('[data-testid="replay-waveform"] span')?.children ?? [])]
    expect(bars.map(bar => (bar as HTMLElement).style.height)).toEqual(['20%', '100%', '50%'])

    // A Noise-like Recording plays no note: no tag.
    await render({ items: [{ ...recording, detail: null }] })
    expect(rowText('profile-shared-tag')).toEqual([null])
  })

  it('a Toot’s bars are fetched once its row is on screen, and it has no picture', async () => {
    laidOut(60, 60)
    // On screen at once.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe() {
          this.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          )
        }
        unobserve() {}
        disconnect() {}
      }
    )
    const fetched = server()
    // A path of its own, since each Toot's row is fetched once a page load.
    await render({ items: [{ ...toot, path: '/@alice/t/vvvvvvvvvvvv/' }] })
    await settle()
    expect(fetched).toContain('/@alice/t/vvvvvvvvvvvv/row/')
    // Its 4 bars, drawn one to each 4 px of its 60 px waveform: 15, from the quietest to the
    // loudest.
    const bars = [
      ...(rows()[0].querySelector('[data-testid="replay-waveform"] span')?.children ?? [])
    ].map(bar => Number.parseFloat((bar as HTMLElement).style.height))
    expect(bars).toHaveLength(15)
    expect(Math.min(...bars)).toBeCloseTo(10)
    expect(Math.max(...bars)).toBeGreaterThan(80)
    expect(rows()[0].querySelector('[data-testid="profile-shared-art"]')).toBeNull()
    expect(rows()[0].querySelector('rect')).toBeNull()
  })

  it('while it plays: the bars it has played in Farty’s pink, and where it is at the bottom left', async () => {
    // Never on screen, so its bars stay the 60 flat ones it draws while they load.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    server()
    await render({ items: [toot] })
    heard.position = 4.6
    await act(async () => rows()[0].querySelector('button')?.click())
    expect(rowText('profile-shared-time')).toEqual(['0:04'])
    expect(rowText('profile-shared-length')).toEqual(['0:18'])
    const bars = [
      ...(rows()[0].querySelector('[data-testid="replay-waveform"] span')?.children ?? [])
    ]
    const pink = bars.filter(bar => bar.className.includes('bg-brand-strong'))
    // 60 flat bars over 18 s while they load, so 0.3 s a bar: the first 16 reach 4.6 s.
    expect(pink).toHaveLength(16)
    expect(bars.slice(0, 16)).toEqual(pink)

    await act(async () => rows()[0].querySelector('button')?.click())
    expect(rowText('profile-shared-time')).toEqual([null])
  })

  it('a Recording’s plays, draws and times only its fart, never the lead-in silence its link serves', async () => {
    server()
    // As the server gives it: 1.46 s served, its fart from 0.32 s after lead-in silence, so 1.14 s
    // of fart and "1.1 s", the length its own page prints.
    const take: ProfileShare = {
      ...recording,
      length: '1.1 s',
      part: { startSeconds: 0.32, endSeconds: 1.46 }
    }
    await render({ items: [take] })
    await act(async () => (tab('Recordings') as HTMLElement).click())
    const frame = () =>
      act(async () => {
        await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
      })
    const waveform = () => rows()[0].querySelector<HTMLElement>('[data-testid="replay-waveform"]')
    // Its waveform spans only the fart.
    expect(waveform()?.getAttribute('aria-valuemin')).toBe('0.32')
    expect(waveform()?.getAttribute('aria-valuemax')).toBe('1.46')

    heard.position = 0.32
    await act(async () => rows()[0].querySelector('button')?.click())
    // From the fart's start to its end: a trim of its own audio.
    expect(heard.plays.at(-1)?.segment).toEqual({ start: 0.32, end: 1.46 })
    const seen: string[] = []
    for (const at of [0.32, 1.02, 1.46, 3]) {
      heard.position = at
      await frame()
      seen.push(rowText('profile-shared-time')[0] ?? '')
    }
    // Timed from the fart's start, it reads the length at the bottom right at its end, and past it.
    expect(seen).toEqual(['0.0 s', '0.7 s', '1.1 s', '1.1 s'])
    expect(rowText('profile-shared-length')).toEqual(['1.1 s'])

    // From a spot, it still stops at the fart's end.
    await act(async () => rows()[0].querySelector('button')?.click())
    heard.position = null
    await act(async () =>
      waveform()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    )
    expect(heard.plays.at(-1)?.segment).toEqual({ start: 0.32 + 1.14 / 12, end: 1.46 })
  })

  it('Copy link copies its own page’s link, and says so', async () => {
    server()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await render({ items: [toot] })
    const link = rows()[0].querySelector<HTMLAnchorElement>('[data-testid="profile-copy-link"]')
    expect(link?.textContent).toBe('Copy link')
    // A plain link to its page, so pressing and holding it copies it too.
    expect(link?.getAttribute('href')).toBe('/@alice/t/tttttttttttt/')
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => link?.dispatchEvent(tap))
    await settle()
    // It copies rather than opening the page.
    expect(tap.defaultPrevented).toBe(true)
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/@alice/t/tttttttttttt/`)
    expect(rowText('profile-copy-said')).toEqual(['Link copied'])
    // With a modifier key it opens, in a new tab, as any link does.
    const opening = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    link?.addEventListener('click', event => event.preventDefault(), { once: true })
    await act(async () => link?.dispatchEvent(opening))
    expect(writeText).toHaveBeenCalledTimes(1)

    writeText.mockRejectedValue(new Error('denied'))
    await act(async () => link?.click())
    await settle()
    expect(rowText('profile-copy-said')).toEqual([
      "Couldn't copy it. Press and hold Copy link to copy it."
    ])
  })

  it('draws thinner bars of the same shape on a wide row, about one to 4 pixels', async () => {
    // happy-dom lays nothing out: a computer's row, 24 pixels wide for 6 bars.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(24)
    server()
    await render({ items: [recording] })
    await act(async () => (tab('Recordings') as HTMLElement).click())
    const bars = [
      ...(rows()[0].querySelector('[data-testid="replay-waveform"] span')?.children ?? [])
    ]
    const heights = bars.map(bar => Number.parseFloat((bar as HTMLElement).style.height))
    expect(heights.map(height => Math.round(height * 10) / 10)).toEqual([
      20, 40, 80, 87.5, 62.5, 50
    ])
  })

  it('never says where a fart was made: only the day, as the shared page says it with a town', async () => {
    server()
    await render({ items: [toot, recording], hero })
    const shown = rows().map(row => row.textContent)
    await act(async () => (tab('Recordings') as HTMLElement).click())
    shown.push(...rows().map(row => row.textContent))
    expect(shown).toEqual([
      '@aliceTwinkle for MumTodaySound Pad0:18Copy link',
      '@aliceRecording 1TodayE31.1 sCopy link'
    ])
  })

  it('loads a Toot’s bars and roll only once its row comes near the screen', async () => {
    const seen: IntersectionObserverCallback[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          seen.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const fetched = server()
    // A path of its own, since each Toot's bars are fetched once a page load.
    await render({ items: [{ ...toot, path: '/@alice/t/uuuuuuuuuuuu/' }] })
    expect(fetched.filter(url => url.endsWith('/row/'))).toEqual([])

    await act(async () =>
      seen.at(-1)?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    )
    await settle()
    expect(fetched.filter(url => url.endsWith('/row/'))).toEqual(['/@alice/t/uuuuuuuuuuuu/row/'])
    const bars = [
      ...(rows()[0].querySelector('[data-testid="replay-waveform"] span')?.children ?? [])
    ]
    expect(bars.map(bar => (bar as HTMLElement).style.height)).toEqual(['10%', '90%', '40%', '70%'])
  })

  it('says when its audio can’t be had, under the row that played it', async () => {
    server()
    vi.mocked(globalThis.fetch).mockImplementation(async input =>
      String(input) === '/api/friends/alice/'
        ? Response.json({ state: 'none' })
        : new Response(null, { status: 404 })
    )
    await render({ items: [recording] })
    await act(async () => (tab('Recordings') as HTMLElement).click())
    await act(async () => rows()[0].querySelector('button')?.click())
    await act(async () => {
      await heard.plays
        .at(-1)
        ?.wav()
        .catch(() => {})
    })
    expect(rows()[0].querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't play it. Check your connection and try again."
    )
  })
})
