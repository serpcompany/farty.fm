import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A profile page's friend control (#319) in a DOM, signed in: when the friend state can't be read
// (offline, a timeout, or a session the server ended) it says so with Retry, as Profile's Friends
// does, rather than staying a blank space. The server is `fetch`, answering as the route does.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedIn', id: 'userbob' } })
}))
vi.mock('@/lib/audio/player', () => ({ play: vi.fn(), stopPlayback: () => {} }))

let root: Root | null = null
let container: HTMLDivElement

/** The friend-state route answers each of `answers` in turn: a Response, or a failed fetch. */
function server(...answers: (Response | 'offline')[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    expect(String(input)).toBe('/api/friends/alice/')
    const next = answers.shift()
    if (next === undefined || next === 'offline') throw new TypeError('Failed to fetch')
    return next
  })
}

async function render() {
  const { ProfilePage } = await import('./profile-page')
  await act(async () => root?.render(<ProfilePage handle="alice" items={[]} />))
}

const retry = () =>
  [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry')

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
})

describe('The friend control when the friend state can’t be read', () => {
  it('says so with Retry, and Retry reads it again', async () => {
    const fetch = server('offline', Response.json({ state: 'none' }))
    await render()
    expect(container.textContent).toContain("Can't reach your friends right now.")
    expect(container.textContent).not.toContain('Add friend')

    await act(async () => retry()?.click())
    expect(fetch).toHaveBeenCalledTimes(2)
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

describe('A shared Toot’s row (#346)', () => {
  it('says it’s a Toot and its Song, opens its own page and plays its own audio', async () => {
    const fetched: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      fetched.push(String(input))
      return String(input) === '/api/friends/alice/'
        ? Response.json({ state: 'none' })
        : new Response(new ArrayBuffer(8))
    })
    const { play } = await import('@/lib/audio/player')
    const { ProfilePage } = await import('./profile-page')
    const now = Date.now()
    await act(async () =>
      root?.render(
        <ProfilePage
          handle="alice"
          items={[
            {
              kind: 'toots',
              shareId: 'tttttttttttt',
              path: '/@alice/t/tttttttttttt/',
              name: 'Twinkle for Mum',
              detail: 'Sound Pad',
              sharedAt: now
            },
            {
              kind: 'recordings',
              shareId: 'rrrrrrrrrrrr',
              path: '/@alice/r/rrrrrrrrrrrr/',
              name: 'Recording 1',
              detail: 'E3',
              sharedAt: now
            }
          ]}
        />
      )
    )
    const rows = [...container.querySelectorAll('[data-testid="profile-shared-item"]')]
    expect(rows.map(row => row.querySelector('a')?.textContent)).toEqual([
      'Twinkle for MumToot · Sound Pad · Today',
      'Recording 1Recording · E3 · Today'
    ])
    // Next's Link drops the trailing slash here, outside a build with `trailingSlash`.
    expect(rows.map(row => row.querySelector('a')?.getAttribute('href'))).toEqual([
      '/@alice/t/tttttttttttt',
      '/@alice/r/rrrrrrrrrrrr'
    ])

    await act(async () => rows[0].querySelector('button')?.click())
    const [key, load] = vi.mocked(play).mock.calls.at(-1) ?? []
    expect(key).toBe('shared:tttttttttttt')
    await load?.()
    expect(fetched).toContain('/@alice/t/tttttttttttt/audio/')
  })
})
