import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SongSummary } from '@/lib/catalog/song'
import { songs } from '@/lib/catalog/songs.generated'
import type { SongRow } from '@/lib/pitch-coverage'

// Compose's Kind and Show dropdowns and its Sort (#397) in a DOM: checkbox menus that stay open while
// you pick, a filled dropdown with its × for each filter on, search within them, the choices kept in
// this browser, and what Compose says when they leave no Song. The Songs are real catalog Songs, a
// few of each kind, so their kinds and origins are the catalog's; which are Unlocked and Favorite is
// the test's.

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
  favorites: new Set<string>() as ReadonlySet<string> | null,
  fartChoices: new Map() as ReadonlyMap<string, unknown> | null
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
vi.mock('./use-fart-choices', () => ({ useFartChoices: () => page.fartChoices }))
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
  page.fartChoices = new Map()
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

const buttons = () => [...document.querySelectorAll('button')]
const button = (name: string) => {
  const found = buttons().find(b => (b.getAttribute('aria-label') ?? b.textContent) === name)
  if (!found) throw new Error(`No button ${name}`)
  return found
}
/** Kind, Show or Sort's dropdown, whatever it's named now: "Kind", or "Kind: Kids, Hymns". */
const dropdown = (name: string) => {
  const found = buttons().find(b => b.getAttribute('aria-label')?.match(`^${name}(:|$)`))
  if (!found) throw new Error(`No dropdown ${name}`)
  return found
}
/** What a dropdown shows, and whether a filter fills it. */
const face = (name: string) => dropdown(name).textContent
const filled = (name: string) => dropdown(name).parentElement?.classList.contains('bg-primary')
const clearButtons = () =>
  buttons()
    .map(b => b.getAttribute('aria-label') ?? '')
    .filter(label => label.startsWith('Clear') && label !== 'Clear search')

const menuItems = () => [
  ...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"], [role="menuitemradio"]')
]
const item = (name: string) => {
  const found = menuItems().find(i => i.textContent === name)
  if (!found) throw new Error(`No menu item ${name}`)
  return found
}
const ticked = () =>
  menuItems()
    .filter(i => i.getAttribute('aria-checked') === 'true')
    .map(i => i.textContent)

const tap = async (element: HTMLElement) => act(async () => element.click())
/** Taps each of `names` in `menu`, opening it first and closing it after. */
async function pick(menu: string, ...names: string[]) {
  await tap(dropdown(menu))
  for (const name of names) await tap(item(name))
  await tap(dropdown(menu))
}
const shown = () =>
  [...document.querySelectorAll('[data-testid="song-row"]')].map(row =>
    row.getAttribute('data-song')
  )
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

it('shows Kind, Show and Sort in one row, nothing filled, and every Song', async () => {
  await show()
  const row = document.querySelector('[data-testid="song-filters"]')
  expect(['Kind', 'Show', 'Sort'].map(face)).toEqual(['Kind', 'Show', 'Sort'])
  expect(['Kind', 'Show', 'Sort'].every(name => row?.contains(dropdown(name)))).toBe(true)
  expect(['Kind', 'Show', 'Sort'].map(filled)).toEqual([false, false, false])
  expect(clearButtons()).toEqual([])
  expect(shown()).toHaveLength(catalog.length)
  expect(document.body.textContent).toContain('Sound Pad')
})

it('shows no Song until the Fart Choices are read, which can lock one (#372)', async () => {
  page.fartChoices = null
  await show()
  expect(shown()).toEqual([])
  expect(document.querySelector('[data-slot="spinner"], [role="status"]')).not.toBeNull()
})

it('chooses several kinds in a menu that stays open, and its top row turns them all off', async () => {
  await show()
  await tap(dropdown('Kind'))
  expect(menuItems().map(i => i.textContent)).toEqual([
    'All kinds',
    'Well known',
    'Christmas',
    'Kids',
    'Hymns',
    'Anthems',
    'Classical',
    'Songs',
    'Fiddle tunes'
  ])
  expect(ticked()).toEqual(['All kinds'])

  // One Kind: the dropdown fills and names it. The menu is still open.
  await tap(item('Christmas'))
  expect(ticked()).toEqual(['Christmas'])
  expect(face('Kind')).toBe('Christmas')
  expect(filled('Kind')).toBe(true)
  expect(dropdown('Kind').getAttribute('aria-label')).toBe('Kind: Christmas')
  expect(shown().sort()).toEqual(['jingle', 'merryxmas'])
  // The Sound Pad shows with every Song only, as with the other filters.
  expect(document.body.textContent).not.toContain('Sound Pad')

  // Two: it counts them, and a Song in any of them shows.
  await tap(item('Kids'))
  expect(ticked()).toEqual(['Christmas', 'Kids'])
  expect(face('Kind')).toBe('Kind · 2')
  expect(dropdown('Kind').getAttribute('aria-label')).toBe('Kind: Christmas, Kids')
  expect(shown().sort()).toEqual(ids(s => s.kind === 'Christmas' || s.kind === 'Kids').sort())

  // A second tap takes one off, and it names the one left.
  await tap(item('Christmas'))
  expect(face('Kind')).toBe('Kids')
  expect(shown().sort()).toEqual(ids(s => s.kind === 'Kids').sort())

  // Well known holds Songs of every kind: here the iPhone's 12, not the Anthem or the Irish tune.
  await tap(item('Kids'))
  await tap(item('Well known'))
  expect(shown()).toHaveLength(12)
  expect(shown()).not.toContain(anthem.id)

  await tap(item('Anthems'))
  expect(face('Kind')).toBe('Kind · 2')
  await tap(item('All kinds'))
  expect(ticked()).toEqual(['All kinds'])
  expect(face('Kind')).toBe('Kind')
  expect(filled('Kind')).toBe(false)
  expect(shown()).toHaveLength(catalog.length)
  expect(document.body.textContent).toContain('Sound Pad')
  expect(menuItems()).toHaveLength(9)
})

it('narrows Kind and Show by each other, Ready and Favorites by each other, and search', async () => {
  page.favorites = new Set(['twinkle', 'row', 'jingle'])
  await show()
  await pick('Kind', 'Kids')
  await tap(dropdown('Show'))
  expect(menuItems().map(i => i.textContent)).toEqual(['All Songs', 'Ready', 'Favorites'])
  expect(ticked()).toEqual(['All Songs'])
  await tap(item('Ready'))
  // The Unlocked Kids' Songs only.
  expect(shown().sort()).toEqual(['mary', 'twinkle'])
  expect(face('Show')).toBe('Ready')
  await tap(item('Favorites'))
  // And of those, the Favorites: Row, Row, Row Your Boat is a Favorite, but locked.
  expect(ticked()).toEqual(['Ready', 'Favorites'])
  expect(shown()).toEqual(['twinkle'])
  expect(face('Show')).toBe('Show · 2')
  expect(dropdown('Show').getAttribute('aria-label')).toBe('Show: Ready, Favorites')
  await tap(item('Ready'))
  expect(shown().sort()).toEqual(['row', 'twinkle'])
  expect(face('Show')).toBe('Favorites')
  await tap(item('All Songs'))
  expect(face('Show')).toBe('Show')
  await tap(dropdown('Show'))

  // Search looks within the kind, by title and by origin.
  await search('row')
  expect(shown()).toEqual(['row'])
  await pick('Kind', 'Fiddle tunes')
  await search('irish')
  expect(shown()).toEqual([irishTune.id])
  // A kind's word finds it from every Song.
  await tap(button('Clear Kind'))
  await search('hymn')
  expect(shown().sort()).toEqual(ids(s => s.kind === 'Hymns').sort())
})

it('clears each dropdown with its own ×, and keeps the other', async () => {
  page.favorites = new Set(['twinkle'])
  await show()
  await pick('Kind', 'Kids', 'Hymns')
  await pick('Show', 'Favorites')
  expect(clearButtons()).toEqual(['Clear Kind', 'Clear Show'])
  expect(shown()).toEqual(['twinkle'])

  await tap(button('Clear Kind'))
  expect(face('Kind')).toBe('Kind')
  expect(filled('Kind')).toBe(false)
  expect(document.activeElement).toBe(dropdown('Kind'))
  expect(face('Show')).toBe('Favorites')
  expect(filled('Show')).toBe(true)
  expect(clearButtons()).toEqual(['Clear Show'])
  expect(shown()).toEqual(['twinkle'])
  expect(localStorage.getItem('pedos.composeKind')).toBe('')

  await tap(button('Clear Show'))
  expect(document.activeElement).toBe(dropdown('Show'))
  expect(clearButtons()).toEqual([])
  expect(shown()).toHaveLength(catalog.length)
  expect(localStorage.getItem('pedos.composeFavorites')).toBe('false')
  // There's no Clear all.
  expect(document.body.textContent).not.toContain('Clear all')
})

it('sorts from a menu that closes on a pick, and never fills', async () => {
  await show()
  expect(dropdown('Sort').getAttribute('aria-label')).toBe('Sort: Closest to unlocking')
  await tap(dropdown('Sort'))
  expect(menuItems().map(i => i.textContent)).toEqual([
    'Closest to unlocking',
    'Most popular',
    'Fewest notes',
    'A–Z'
  ])
  expect(ticked()).toEqual(['Closest to unlocking'])
  await tap(item('Fewest notes'))
  expect(dropdown('Sort').getAttribute('aria-label')).toBe('Sort: Fewest notes')
  expect(face('Sort')).toBe('Fewest notes')
  expect(filled('Sort')).toBe(false)
  expect(clearButtons()).toEqual([])
  expect(localStorage.getItem('pedos.composeOrder')).toBe('fewestNotes')
})

it('goes back to the first Song on a choice that changes the list, and on no other tap', async () => {
  const toTop = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  // A filter this browser kept moves nothing as it lands, or Back from Song Creator would lose
  // your place.
  localStorage.setItem('pedos.composeKind', 'Hymns')
  await show()
  expect(face('Kind')).toBe('Hymns')
  expect(toTop).not.toHaveBeenCalled()

  await tap(button('Clear Kind'))
  expect(toTop).toHaveBeenCalledTimes(1)

  // Nothing is on, so the top row, ticked already, changes nothing.
  await tap(dropdown('Kind'))
  await tap(item('All kinds'))
  expect(ticked()).toEqual(['All kinds'])
  expect(toTop).toHaveBeenCalledTimes(1)
  await tap(item('Kids'))
  expect(toTop).toHaveBeenCalledTimes(2)
  await tap(item('All kinds'))
  expect(toTop).toHaveBeenCalledTimes(3)
  await tap(dropdown('Kind'))

  await tap(dropdown('Sort'))
  await tap(item('Closest to unlocking'))
  expect(toTop).toHaveBeenCalledTimes(3)
  await tap(dropdown('Sort'))
  await tap(item('Fewest notes'))
  expect(toTop).toHaveBeenCalledTimes(4)
  expect(toTop).toHaveBeenLastCalledWith(0, 0)
  toTop.mockRestore()
})

it("shows only Sort's icon where its label doesn't fit, keeping its name", async () => {
  // The whole face needs more than the row leaves it. happy-dom lays nothing out.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(150)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
  localStorage.setItem('pedos.composeOrder', 'fewestNotes')
  await show()
  expect(face('Sort')).toBe('')
  expect(dropdown('Sort').querySelectorAll('svg')).toHaveLength(1)
  expect(dropdown('Sort').getAttribute('aria-label')).toBe('Sort: Fewest notes')
  vi.restoreAllMocks()
})

it.each([
  ['composeKind', 'Hymns', 'Kind', 'Hymns', ['amazing', 'saints']],
  ['composeReady', 'true', 'Show', 'Ready', ['jingle', 'mary', 'saints', 'twinkle']],
  ['composeFavorites', 'true', 'Show', 'Favorites', ['amazing', 'row']]
])('lands on the %s a browser kept before these menus, filled', async (key, kept, menu, label, rows) => {
  page.favorites = new Set(['amazing', 'row'])
  localStorage.setItem(`pedos.${key}`, kept)
  await show()
  expect(face(menu)).toBe(label)
  expect(filled(menu)).toBe(true)
  expect(clearButtons()).toEqual([`Clear ${menu}`])
  expect(shown().sort()).toEqual(rows)
  await tap(dropdown(menu))
  expect(ticked()).toEqual([label])
})

it('lands on Ready and Favorites together, as a browser kept them', async () => {
  localStorage.setItem('pedos.composeReady', 'true')
  localStorage.setItem('pedos.composeFavorites', 'true')
  page.favorites = new Set(['twinkle', 'row'])
  await show()
  expect(face('Show')).toBe('Show · 2')
  expect(filled('Show')).toBe(true)
  expect(shown()).toEqual(['twinkle'])
})

it('keeps the choices in this browser, and reads a kind not in the menu as none', async () => {
  await show()
  await pick('Kind', 'Hymns', 'Anthems')
  await pick('Show', 'Ready')
  expect(localStorage.getItem('pedos.composeKind')).toBe('Hymns,Anthems')
  expect(localStorage.getItem('pedos.composeReady')).toBe('true')

  act(() => root?.unmount())
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await show()
  expect(face('Kind')).toBe('Kind · 2')
  expect(face('Show')).toBe('Ready')
  expect(shown()).toEqual(['saints'])

  act(() => root?.unmount())
  root = createRoot(document.body.appendChild(document.createElement('div')))
  localStorage.setItem('pedos.composeKind', 'Lullabies')
  localStorage.setItem('pedos.composeReady', 'false')
  await show()
  expect(face('Kind')).toBe('Kind')
  expect(filled('Kind')).toBe(false)
  expect(shown()).toHaveLength(catalog.length)

  // One Kind left of two kept reads as that one.
  act(() => root?.unmount())
  root = createRoot(document.body.appendChild(document.createElement('div')))
  localStorage.setItem('pedos.composeKind', 'Lullabies,Hymns')
  await show()
  expect(face('Kind')).toBe('Hymns')
})

it('says why no Song shows, and Show all Songs takes the Kinds off too', async () => {
  // Jingle Bells is the only Unlocked Christmas Song: lock it.
  page.unlocked.delete('jingle')
  await show()
  await pick('Kind', 'Christmas')
  await pick('Show', 'Ready')
  expect(shown()).toEqual([])
  expect(noSongs()).toContain('No Ready Songs in Christmas yet')
  await tap(button('Show all Songs'))
  expect(filled('Kind')).toBe(false)
  expect(filled('Show')).toBe(false)
  expect(shown()).toHaveLength(catalog.length)
  expect(localStorage.getItem('pedos.composeKind')).toBe('')
  expect(localStorage.getItem('pedos.composeReady')).toBe('false')

  // Several Kinds, each named.
  await pick('Kind', 'Christmas', 'Anthems')
  await pick('Show', 'Ready')
  expect(noSongs()).toContain('No Ready Songs in Christmas, Anthems yet')
  await tap(button('Show all Songs'))

  // Favorites, but none of this kind.
  page.favorites = new Set(['twinkle'])
  await pick('Kind', 'Anthems')
  await pick('Show', 'Favorites')
  expect(noSongs()).toContain('No Favorites in Anthems')
  await pick('Show', 'Ready')
  expect(noSongs()).toContain('No Ready Favorites in Anthems')
  await tap(button('Show all Songs'))
  expect(filled('Kind')).toBe(false)

  // A search the kinds hide offers every Song, and keeps the search.
  await pick('Kind', 'Anthems', 'Hymns')
  await search('twinkle')
  expect(noSongs()).toContain('No Songs in Hymns, Anthems match “twinkle”')
  await tap(button('Search all Songs'))
  expect(filled('Kind')).toBe(false)
  expect(shown()).toEqual(['twinkle'])
})
