import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/lib/account'
import type { Recording } from '@/lib/recordings'
import type { Toot } from '@/lib/toot'
import { button, closeScreens, dialogs, pageText, settle, show, tap } from '@/test-support/screen'
import { useAccount } from './account-provider'
import { ProfileScreen } from './profile-screen'
import { useRecordings } from './recordings-provider'
import { useToots } from './toots-provider'

vi.mock('./account-provider', () => ({ useAccount: vi.fn() }))
vi.mock('./fixture-library', () => ({ FixtureLibrary: () => <h2>Internal build</h2> }))
vi.mock('./recordings-provider', () => ({ useRecordings: vi.fn() }))
vi.mock('./toots-provider', () => ({ useToots: vi.fn() }))

const signedIn: Account = { status: 'signedIn', id: 'u1', email: 'a@b.c', marketingEmail: true }

const failing = {
  signOut: vi.fn(async () => 'failed'),
  deleteAccount: vi.fn(async () => false),
  setMarketingEmail: vi.fn(async () => false)
}

function holding({
  recordings = [],
  toots = [],
  account = signedIn
}: {
  recordings?: Recording[] | null
  toots?: Toot[] | null
  account?: Account
}) {
  vi.mocked(useRecordings).mockReturnValue({
    recordings,
    melodicRecordings: [],
    collectedNotes: new Set(),
    songRows: []
  } as unknown as ReturnType<typeof useRecordings>)
  vi.mocked(useToots).mockReturnValue({ toots } as unknown as ReturnType<typeof useToots>)
  vi.mocked(useAccount).mockReturnValue({ account, ...failing } as unknown as ReturnType<
    typeof useAccount
  >)
  return <ProfileScreen version="1.0.0" />
}

const inStats = (selector: string) =>
  document.body.querySelector(`section[aria-labelledby="profile-stats"] ${selector}`)
const problem = () => document.body.querySelector('[role="alert"]')?.textContent

afterEach(closeScreens)

describe('Profile', () => {
  it('shows a spinner while the stats load', async () => {
    const render = await show(holding({ recordings: null }))
    expect(inStats('[role="status"]')).not.toBeNull()

    await render(holding({ toots: null }))
    expect(inStats('[role="status"]')).not.toBeNull()

    await render(holding({}))
    expect(inStats('[role="status"]')).toBeNull()
    expect(inStats('[data-testid="stat-recordings"]')?.textContent).toBe('Recordings0')
  })

  it('has no Fixture Library in a build without it, as Production’s is', async () => {
    await show(holding({}))
    await settle()
    expect(pageText()).toContain('About')
    expect(pageText()).not.toContain('Internal build')
  })

  it.each([
    [
      'sign out',
      "Couldn't sign out. Check your connection and try again.",
      () => tap(button('Sign out'))
    ],
    [
      'delete your account',
      "Couldn't delete your account. Check your connection and try again.",
      async () => {
        await tap(button('Delete account'))
        await tap(button('Delete'))
      }
    ],
    [
      'change Farty news',
      "Couldn't change Farty news. Try again.",
      async () => {
        const news = document.body.querySelector<HTMLElement>('#farty-news')
        if (!news) throw new Error('No Farty news switch')
        await tap(news)
      }
    ]
  ])("says it couldn't %s when the request fails", async (_, words, act) => {
    await show(holding({}))
    await act()

    expect(problem()).toBe(words)
    expect(dialogs()).toEqual([])
    expect(button('Sign out').disabled).toBe(false)
  })
})
