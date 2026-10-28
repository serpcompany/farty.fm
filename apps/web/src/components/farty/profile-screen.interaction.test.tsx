import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, AccountChange } from '@/lib/account'
import type { Recording } from '@/lib/recordings'
import type { Toot } from '@/lib/toot'
import { giveToken, siteKeyAnswer, widgets } from '@/test-support/fake-turnstile'
import {
  button,
  closeScreens,
  dialogs,
  pageText,
  settle,
  show,
  tap,
  type
} from '@/test-support/screen'
import { type NotUploaded, useAccount } from './account-provider'
import { ProfileScreen } from './profile-screen'
import { useRecordings } from './recordings-provider'
import { useToots } from './toots-provider'

vi.mock('./account-provider', () => ({ useAccount: vi.fn() }))
vi.mock('./fixture-library', () => ({ FixtureLibrary: () => <h2>Internal build</h2> }))
vi.mock('./recordings-provider', () => ({ useRecordings: vi.fn() }))
vi.mock('./toots-provider', () => ({ useToots: vi.fn() }))
vi.mock('./turnstile', () => import('@/test-support/fake-turnstile'))

const signedIn: Account = { status: 'signedIn', id: 'u1', email: 'a@b.c', marketingEmail: true }

type DeleteAccount = () => Promise<AccountChange>

type SignOut = (anyway?: boolean) => Promise<'failed' | NotUploaded>

const failing = {
  signOut: vi.fn(async () => 'failed' as const),
  setMarketingEmail: vi.fn(async () => false)
}

function holding({
  recordings = [],
  toots = [],
  account = signedIn,
  deleteAccount = async () => 'failed',
  signOut = failing.signOut
}: {
  recordings?: Recording[] | null
  toots?: Toot[] | null
  account?: Account
  deleteAccount?: DeleteAccount
  signOut?: SignOut
}) {
  vi.mocked(useRecordings).mockReturnValue({
    recordings,
    melodicRecordings: [],
    collectedNotes: new Set(),
    songRows: []
  } as unknown as ReturnType<typeof useRecordings>)
  vi.mocked(useToots).mockReturnValue({ toots } as unknown as ReturnType<typeof useToots>)
  vi.mocked(useAccount).mockReturnValue({
    account,
    ...failing,
    deleteAccount,
    signOut
  } as unknown as ReturnType<typeof useAccount>)
  return <ProfileScreen version="1.0.0" />
}

const inStats = (selector: string) =>
  document.body.querySelector(`section[aria-labelledby="profile-stats"] ${selector}`)
const problem = () => document.body.querySelector('[role="alert"]')?.textContent

afterEach(() => {
  closeScreens()
  widgets.length = 0
  vi.restoreAllMocks()
})

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

  it('deletes straight after the confirm with a recent sign-in, asking for no code', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const deleteAccount = vi.fn<DeleteAccount>(async () => 'done')
    await show(holding({ deleteAccount }))
    await tap(button('Delete account'))
    await tap(button('Delete'))

    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(widgets).toEqual([])
    expect(pageText()).not.toContain('sign in again')
  })
})

describe('Sign out with farts not uploaded', () => {
  it.each([
    [
      'all with no room',
      { full: 2, waiting: 0 },
      "Your account is full2 farts on this device aren't in your account because it's full. Delete some to make room, or sign out now and lose them.",
      'Keep them'
    ],
    [
      'one with no room',
      { full: 1, waiting: 0 },
      "Your account is full1 fart on this device isn't in your account because it's full. Delete some to make room, or sign out now and lose it.",
      'Keep it'
    ],
    [
      'some with no room and some not sent',
      { full: 1, waiting: 2 },
      "Not uploaded yetSome farts on this device haven't reached your account, and 1 more can't because it's full. Check your connection and wait, or sign out now and lose them.",
      'Wait'
    ],
    [
      'none with no room',
      { full: 0, waiting: 1 },
      "Not uploaded yetSome farts on this device haven't reached your account. Check your connection and wait, or sign out now and lose them.",
      'Wait'
    ]
  ])('says why farts here haven’t reached the account (%s), then keeps them or signs out anyway', async (_, left, words, keep) => {
    const signOut = vi.fn<SignOut>(async anyway => (anyway ? 'failed' : left))
    await show(holding({ signOut }))
    await tap(button('Sign out'))
    expect(dialogs().map(dialog => dialog.textContent)).toEqual([`${words}${keep}Sign out anyway`])

    await tap(button(keep))
    expect(dialogs()).toEqual([])
    expect(signOut).toHaveBeenCalledExactlyOnceWith(false)

    await tap(button('Sign out'))
    await tap(button('Sign out anyway'))
    expect(signOut).toHaveBeenLastCalledWith(true)
  })
})

const signInAnswers = {
  wrong: () => Response.json({ code: 'INVALID_OTP' }, { status: 400 }),
  expired: () => Response.json({ code: 'OTP_EXPIRED' }, { status: 400 }),
  tooMany: () => new Response(null, { status: 429 }),
  offline: () => Response.error(),
  right: () => Response.json({ user: { id: 'u1', email: 'a@b.c' } })
}

function authServer(...signIns: (keyof typeof signInAnswers)[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.startsWith('/api/auth/turnstile')) return siteKeyAnswer()
    if (!url.includes('/sign-in/email-otp')) return Response.json({ success: true })
    const answer = signInAnswers[signIns.shift() ?? 'offline']()
    if (answer.type === 'error') throw new TypeError('offline')
    return answer
  })
}

const sentTo = (fetch: ReturnType<typeof authServer>, path: string) =>
  fetch.mock.calls
    .filter(([url]) => String(url).includes(path))
    .map(([, init]) => ({
      body: JSON.parse(String(init?.body)),
      captcha: new Headers(init?.headers).get('x-captcha-response')
    }))

const codeField = () => document.body.querySelector<HTMLInputElement>('#delete-account-code')

async function confirmDelete(deleteAccount: DeleteAccount) {
  await show(holding({ deleteAccount }))
  await tap(button('Delete account'))
  await tap(button('Delete'))
}

async function askForCode(deleteAccount: DeleteAccount) {
  await confirmDelete(deleteAccount)
  await giveToken(0, 'token-1')
  await tap(button('Send code'))
}

async function enterCode(code: string) {
  const field = codeField()
  if (!field) throw new Error('No Code field')
  await type(field, code)
  await tap(button('Delete'))
}

describe('Delete account after an old sign-in', () => {
  it('asks for a new code, sent to the account’s email with Turnstile’s token, then deletes', async () => {
    const fetch = authServer('wrong', 'right')
    const deleteAccount = vi
      .fn<DeleteAccount>()
      .mockResolvedValueOnce('signInAgain')
      .mockResolvedValueOnce('done')
    await confirmDelete(deleteAccount)

    expect(pageText()).toContain(
      "To delete your account, sign in again. We'll send a code to a@b.c."
    )
    expect(widgets).toHaveLength(1)
    expect(button('Send code').disabled).toBe(true)
    await giveToken(0, 'token-1')
    await tap(button('Send code'))
    expect(sentTo(fetch, '/send-verification-otp')).toEqual([
      { body: { email: 'a@b.c', type: 'sign-in' }, captcha: 'token-1' }
    ])
    expect(pageText()).toContain('Enter the code we sent to a@b.c to delete your account.')
    expect(document.activeElement).toBe(codeField())

    await enterCode('000000')
    expect(problem()).toBe("That code isn't right. Check it and try again.")
    expect(deleteAccount).toHaveBeenCalledTimes(1)

    await enterCode('123 456')
    expect(sentTo(fetch, '/sign-in/email-otp').map(sent => sent.body)).toEqual([
      { email: 'a@b.c', otp: '000000' },
      { email: 'a@b.c', otp: '123 456' }
    ])
    expect(deleteAccount).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['tooMany', 'Too many tries. Wait a few minutes, then try again.'],
    ['offline', "Couldn't reach Farty. Check your connection and try again."]
  ] as const)('says what went wrong as sign-in does (%s), and deletes nothing', async (answer, words) => {
    authServer(answer)
    const deleteAccount = vi.fn<DeleteAccount>(async () => 'signInAgain')
    await askForCode(deleteAccount)
    await enterCode('123456')

    expect(problem()).toBe(words)
    expect(codeField()).not.toBeNull()
    expect(deleteAccount).toHaveBeenCalledTimes(1)
  })

  it('goes back to Send code when the code no longer works', async () => {
    authServer('expired')
    const deleteAccount = vi.fn<DeleteAccount>(async () => 'signInAgain')
    await askForCode(deleteAccount)
    await enterCode('123456')

    expect(problem()).toBe('That code no longer works. Send a new one.')
    expect(codeField()).toBeNull()
    expect(widgets).toHaveLength(2)
    expect(button('Send code').disabled).toBe(true)
    expect(deleteAccount).toHaveBeenCalledTimes(1)
  })

  it('starts again from the confirm once closed', async () => {
    authServer()
    await askForCode(vi.fn<DeleteAccount>(async () => 'signInAgain'))
    await tap(button('Cancel'))
    expect(dialogs()).toEqual([])

    await tap(button('Delete account'))
    expect(pageText()).toContain("It can't be undone.")
    expect(codeField()).toBeNull()
  })
})
