import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SongSummary } from '@/lib/catalog/song'
import { songs } from '@/lib/catalog/songs.generated'
import type { SongRow } from '@/lib/pitch-coverage'

// Compose's Kind chips (#384) in a DOM: one choice at a time, which a second tap takes off, with
// the Ready and Favorites filters and search, kept in this browser, and what Compose says when the
// choice and the filters leave no Song. The Songs are real catalog Songs, a few of each kind, so
// their kinds and origins are the catalog's; which are Unlocked and Favorite is the test's.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const first = (test: (s: SongSummary) => boolean) => {
  const found = songs.find(test)
  if (!found) throw new Error('No such Song')
  return found
}
/** The iPhone app's 12, every one Well known, and two that aren't: an Anthem and an Irish tune. */
const catalog: SongSummary[] = [
  ...songs.slice(0, 12),
  first(s => s.kind === 'Anthems' && !s.wellKnown),
  first(s => s.kind === 'Fiddle tunes' && s.origin === 'Irish' && !s.wellKnown)
]
const [anthem, irishTune] = catalog.slice(12)

const page = vi.hoisted(() => ({
  unlocked: new Set<string>(),
  favorites: new Set<string>() as ReadonlySet<string> | null
}))

vi.mock('./pedos-provider', () => ({
  usePedos: () => ({
    songs: catalog,
    songsFailed: false,
    reloadSongs: () => {},
    recordings: [],
    melodicRecordings: [{ id: 'r1' }],
    songRows: catalog.map(
      (song): SongRow => ({
        song,
        coverage: {
          covered: page.unlocked.has(song.id) ? song.pitches.length : 0,
          total: song.pitches.length,
          hasMelodicRecordings: true,
          unlocked: page.unlocked.has(song.id)
        }
      })
    )
  })
}))
vi.mock('./favorite-button', () => ({
  useFavorites: () => page.favorites,
  FavoriteButton: () => null
}))
vi.mock('./locked-song-sheet', () => ({ LockedSongSheet: () => null }))
vi.mock('./report-song-sheet', () => ({ ReportSongSheet: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  )
}))

let root: Root | null = null

beforeEach(() => {
  localStorage.clear()
  page.unlocked = new Set(['twinkle', 'mary', 'jingle', 'saints'])
  page.favorites = new Set()
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function show() {
  const { ComposeScreen } = await import('./compose-screen')
  await act(async () => root?.render(<ComposeScreen />))
}

const button = (name: string) => {
  const found = [...document.querySelectorAll('button')].find(
    b => (b.getAttribute('aria-label') ?? b.textContent) === name
  )
  if (!found) throw new Error(`No button ${name}`)
  return found
}
const kindChips = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[data-testid="kind-chips"] button')
]
const chip = (name: string) => {
  const found = kindChips().find(b => b.textContent === name)
  if (!found) throw new Error(`No chip ${name}`)
  return found
}
const chosen = () => kindChips().filter(b => b.getAttribute('aria-pressed') === 'true')
const tap = async (element: HTMLElement) => act(async () => element.click())
const shown = () =>
  [...document.querySelectorAll('[data-testid="song-row"]')].map(row =>
    row.getAttribute('data-song')
  )
const kindCount = () => document.querySelector('[data-testid="kind-count"]')?.textContent ?? null
const noSongs = () => document.querySelector('[data-testid="no-songs"]')?.textContent ?? null
const ids = (test: (s: SongSummary) => boolean) => catalog.filter(test).map(s => s.id)

async function search(query: string) {
  const box = document.querySelector<HTMLInputElement>('input[type="search"]')
  if (!box) throw new Error('No search box')
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(box, query)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('shows the 8 Kind chips, none chosen, and every Song', async () => {
  await show()
  expect(kindChips().map(b => b.textContent)).toEqual([
    'Well known',
    'Christmas',
    'Kids',
    'Hymns',
    'Anthems',
    'Classical',
    'Songs',
    'Fiddle tunes'
  ])
  expect(chosen()).toEqual([])
  expect(document.querySelector('[data-testid="kind-chips"] legend')?.textContent).toBe('Kinds')
  expect(shown()).toHaveLength(catalog.length)
  expect(kindCount()).toBeNull()
  expect(document.body.textContent).toContain('Sound Pad')
})

it('chooses one kind at a time, and a second tap shows every Song again', async () => {
  await show()
  await tap(chip('Christmas'))
  expect(chosen().map(b => b.textContent)).toEqual(['Christmas'])
  expect(shown().sort()).toEqual(['jingle', 'merryxmas'])
  expect(kindCount()).toBe('Christmas · 2')
  // The Sound Pad shows with every Song only, as with the other filters.
  expect(document.body.textContent).not.toContain('Sound Pad')

  await tap(chip('Kids'))
  expect(chosen().map(b => b.textContent)).toEqual(['Kids'])
  expect(shown().sort()).toEqual(ids(s => s.kind === 'Kids').sort())
  expect(kindCount()).toBe(`Kids · ${ids(s => s.kind === 'Kids').length}`)

  // Well known holds Songs of every kind: here the iPhone's 12, not the Anthem or the Irish tune.
  await tap(chip('Well known'))
  expect(chosen().map(b => b.textContent)).toEqual(['Well known'])
  expect(shown()).toHaveLength(12)
  expect(shown()).not.toContain(anthem.id)
  expect(kindCount()).toBe('Well known · 12')

  await tap(chip('Well known'))
  expect(chosen()).toEqual([])
  expect(shown()).toHaveLength(catalog.length)
  expect(kindCount()).toBeNull()
  expect(document.body.textContent).toContain('Sound Pad')
})

it('combines with Ready, Favorites and search', async () => {
  page.favorites = new Set(['twinkle', 'row', 'jingle'])
  await show()
  await tap(chip('Kids'))
  await tap(button('Ready'))
  // The Unlocked Kids' Songs only.
  expect(shown().sort()).toEqual(['mary', 'twinkle'])
  expect(kindCount()).toBe('Kids · 2')
  await tap(button('Favorites'))
  // And of those, the Favorites: Row, Row, Row Your Boat is a Favorite, but locked.
  expect(shown()).toEqual(['twinkle'])
  expect(kindCount()).toBe('Kids · 1')
  await tap(button('Ready'))
  expect(shown().sort()).toEqual(['row', 'twinkle'])

  // Search looks within the kind, by title and by origin.
  await tap(button('Favorites'))
  await search('row')
  expect(shown()).toEqual(['row'])
  await tap(chip('Fiddle tunes'))
  await search('irish')
  expect(shown()).toEqual([irishTune.id])
  expect(kindCount()).toBe('Fiddle tunes · 1')
  // A kind's word finds it from every Song.
  await tap(chip('Fiddle tunes'))
  await search('hymn')
  expect(shown().sort()).toEqual(ids(s => s.kind === 'Hymns').sort())
})

it('keeps the choice in this browser, and reads one that is no chip as none', async () => {
  localStorage.setItem('pedos.composeKind', 'Hymns')
  await show()
  expect(chosen().map(b => b.textContent)).toEqual(['Hymns'])
  expect(kindCount()).toBe('Hymns · 2')
  expect(shown().sort()).toEqual(['amazing', 'saints'])

  await tap(chip('Anthems'))
  expect(localStorage.getItem('pedos.composeKind')).toBe('Anthems')
  await tap(chip('Anthems'))
  expect(localStorage.getItem('pedos.composeKind')).toBe('')

  act(() => root?.unmount())
  root = createRoot(document.body.appendChild(document.createElement('div')))
  localStorage.setItem('pedos.composeKind', 'Lullabies')
  await show()
  expect(chosen()).toEqual([])
  expect(shown()).toHaveLength(catalog.length)
})

it('says why no Song shows, and Show all Songs takes the kind off too', async () => {
  // Jingle Bells is the only Unlocked Christmas Song: lock it.
  page.unlocked.delete('jingle')
  await show()
  await tap(chip('Christmas'))
  await tap(button('Ready'))
  expect(shown()).toEqual([])
  expect(kindCount()).toBeNull()
  expect(noSongs()).toContain('No Ready Songs in Christmas yet')
  await tap(button('Show all Songs'))
  expect(chosen()).toEqual([])
  expect(button('Ready').getAttribute('aria-pressed')).toBe('false')
  expect(shown()).toHaveLength(catalog.length)
  expect(localStorage.getItem('pedos.composeKind')).toBe('')

  // Favorites, but none of this kind.
  page.favorites = new Set(['twinkle'])
  await tap(chip('Anthems'))
  await tap(button('Favorites'))
  expect(noSongs()).toContain('No Favorites in Anthems')
  await tap(button('Ready'))
  expect(noSongs()).toContain('No Ready Favorites in Anthems')
  await tap(button('Show all Songs'))
  expect(chosen()).toEqual([])

  // A search the kind hides offers every Song, and keeps the search.
  await tap(chip('Anthems'))
  await search('twinkle')
  expect(noSongs()).toContain('No Songs in Anthems match “twinkle”')
  await tap(button('Search all Songs'))
  expect(chosen()).toEqual([])
  expect(shown()).toEqual(['twinkle'])
})
