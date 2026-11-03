import { afterEach, describe, expect, it, vi } from 'vitest'
import { play } from '@/lib/audio/player'
import { closeScreens, pageText, show, tap } from '@/test-support/screen'
import { ProfilePage } from './profile-page'

vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedIn', id: 'userbob' } })
}))
vi.mock('@/lib/audio/player', () => ({ play: vi.fn(), stopPlayback: () => {} }))

function server(...answers: (Response | 'offline')[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    expect(String(input)).toBe('/api/friends/alice/')
    const next = answers.shift()
    if (next === undefined || next === 'offline') throw new TypeError('Failed to fetch')
    return next
  })
}

const retry = () =>
  [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Retry')

afterEach(() => {
  closeScreens()
  vi.restoreAllMocks()
})

describe('The friend control when the friend state can’t be read', () => {
  it('says so with Retry, and Retry reads it again', async () => {
    const fetch = server('offline', Response.json({ state: 'none' }))
    await show(<ProfilePage handle="alice" items={[]} />)
    expect(pageText()).toContain("Can't reach your friends right now.")
    expect(pageText()).not.toContain('Add friend')

    const button = retry()
    if (!button) throw new Error('No Retry')
    await tap(button)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(pageText()).not.toContain("Can't reach your friends right now.")
    expect(retry()).toBeUndefined()
    expect(pageText()).toContain('Add friend')
  })

  it('says so when the server refuses the session', async () => {
    server(Response.json({ error: 'unauthorized' }, { status: 401 }))
    await show(<ProfilePage handle="alice" items={[]} />)
    expect(pageText()).toContain("Can't reach your friends right now.")
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
    const now = Date.now()
    await show(
      <ProfilePage
        handle="alice"
        items={[
          {
            kind: 'toots',
            shareId: 'tttttttttttt',
            path: '/u/alice/t/tttttttttttt/',
            name: 'Twinkle for Mum',
            detail: 'Sound Pad',
            sharedAt: now
          },
          {
            kind: 'recordings',
            shareId: 'rrrrrrrrrrrr',
            path: '/u/alice/r/rrrrrrrrrrrr/',
            name: 'Recording 1',
            detail: 'E3',
            sharedAt: now
          }
        ]}
      />
    )
    const rows = [...document.body.querySelectorAll('[data-testid="profile-shared-item"]')]
    expect(rows.map(row => row.querySelector('a')?.textContent)).toEqual([
      'Twinkle for MumToot · Sound Pad · Today',
      'Recording 1Recording · E3 · Today'
    ])
    expect(rows.map(row => row.querySelector('a')?.getAttribute('href'))).toEqual([
      '/u/alice/t/tttttttttttt',
      '/u/alice/r/rrrrrrrrrrrr'
    ])

    const playButton = rows[0].querySelector('button')
    if (!playButton) throw new Error('No play button')
    await tap(playButton)
    const [key, load] = vi.mocked(play).mock.calls.at(-1) ?? []
    expect(key).toBe('shared:tttttttttttt')
    await load?.()
    expect(fetched).toContain('/u/alice/t/tttttttttttt/audio/')
  })
})
