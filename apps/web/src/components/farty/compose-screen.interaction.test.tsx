import { afterEach, describe, expect, it, vi } from 'vitest'
import { songs } from '@/lib/catalog/songs.generated'
import { songRows } from '@/lib/pitch-coverage'
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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./recordings-provider', () => ({ useRecordings: vi.fn() }))

function libraryOf(recordings: Recording[] | null) {
  vi.mocked(useRecordings).mockReturnValue({
    recordings,
    melodicRecordings: [],
    collectedPitchClasses: new Set(),
    songRows: songRows(songs, [])
  } as unknown as ReturnType<typeof useRecordings>)
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
    expect(pageText()).toContain(`Locked · ${songs.length}`)
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
      `[data-song="${songs[0].id}"] button`
    )
    if (!row) throw new Error(`No row for ${songs[0].id}`)
    await tap(row)
    expect(dialogs().map(dialog => dialog.textContent)).toEqual([
      expect.stringContaining('Record a fart with a clear note to start.')
    ])

    await hideAndShowPage()
    expect(dialogs()).toEqual([])
  })
})
