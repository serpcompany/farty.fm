import { afterEach, describe, expect, it, vi } from 'vitest'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { coverageOf, songRows } from '@/lib/pitch-coverage'
import type { Recording } from '@/lib/recordings'
import {
  button,
  closeScreens,
  dialogs,
  hideAndShowPage,
  pageText,
  show,
  tap,
  type
} from '@/test-support/screen'
import { ComposeScreen } from './compose-screen'
import { useRecordings } from './recordings-provider'
import { useSongCatalog } from './song-catalog-provider'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./recordings-provider', () => ({ useRecordings: vi.fn() }))
vi.mock('./song-catalog-provider', () => ({ useSongCatalog: vi.fn() }))
vi.mock('./favorite-button', () => ({
  useFavorites: () => new Set(),
  FavoriteButton: () => null
}))
vi.mock('./use-near-viewport', () => ({ useNearViewport: () => true }))

const reloadSongs = vi.fn()

function catalogOf(songsFailed: boolean) {
  vi.mocked(useSongCatalog).mockReturnValue({
    songs: songsFailed ? null : songIndex,
    songsFailed,
    reloadSongs,
    song: id => songIndex.find(song => song.id === id)
  })
}

function libraryOf(recordings: Recording[] | null) {
  catalogOf(false)
  vi.mocked(useRecordings).mockReturnValue({
    recordings,
    melodicRecordings: [],
    collectedPitchClasses: new Set(),
    songRows: songRows(songIndex, []),
    coverage: song => coverageOf(song, [])
  } as Partial<ReturnType<typeof useRecordings>> as ReturnType<typeof useRecordings>)
}

const spinner = () => document.body.querySelector('[role="status"]')
const searchField = () =>
  document.body.querySelector<HTMLInputElement>('input[aria-label="Search Songs"]')

afterEach(closeScreens)

describe('Compose', () => {
  it('shows a spinner while the Recordings load', async () => {
    libraryOf(null)
    const render = await show(<ComposeScreen />)
    expect(spinner()).not.toBeNull()
    expect(pageText()).not.toContain('Locked')

    libraryOf([])
    await render(<ComposeScreen />)
    expect(spinner()).toBeNull()
    expect(pageText()).toContain(`Locked · ${songIndex.length}`)
  })

  it('hides the No Melodic Recordings card while a search is typed', async () => {
    libraryOf([])
    await show(<ComposeScreen />)
    expect(pageText()).toContain('No Melodic Recordings yet')

    const field = searchField()
    if (!field) throw new Error('No search field')
    await type(field, 'lamb')
    expect(pageText()).not.toContain('No Melodic Recordings yet')

    await type(field, '')
    expect(pageText()).toContain('No Melodic Recordings yet')
  })

  it('closes a locked Song’s sheet when the page is hidden', async () => {
    libraryOf([])
    await show(<ComposeScreen />)
    const row = document.body.querySelector<HTMLButtonElement>(
      `[data-song="${songIndex[0].id}"] button`
    )
    if (!row) throw new Error(`No row for ${songIndex[0].id}`)
    await tap(row)
    expect(dialogs().map(dialog => dialog.textContent)).toEqual([
      expect.stringContaining('Record a fart with a clear note to start.')
    ])

    await hideAndShowPage()
    expect(dialogs()).toEqual([])
  })

  it('says the Songs didn’t load, and loads them again on Try again', async () => {
    libraryOf([])
    catalogOf(true)
    await show(<ComposeScreen />)
    expect(pageText()).toContain("Couldn't load the Songs.")
    expect(spinner()).toBeNull()

    await tap(button('Try again'))
    expect(reloadSongs).toHaveBeenCalledOnce()
  })
})
