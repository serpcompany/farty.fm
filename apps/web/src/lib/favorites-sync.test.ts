import { describe, expect, it } from 'vitest'
import type { LibraryChanges } from '@/lib/library-api'
import { claimedBy, libraryHarness } from '@/test-support/library-page'

const library = libraryHarness()
const { recorded, outbox, requests, refuse } = library

describe('Favorite Songs (#313)', () => {
  const favorites = () => library.page.favorites.loadFavorites().then(ids => ids.sort())

  it('keeps each tap here and queues it, a tap undoing an unsent one leaving nothing', async () => {
    await library.page.favorites.setFavorite('twinkle', true)
    await library.page.favorites.setFavorite('mary', true)
    await library.page.favorites.setFavorite('mary', false)
    await library.page.favorites.setFavorite('twinkle', true)
    expect(await favorites()).toEqual(['twinkle'])
    expect((await outbox()).map(e => [e.key, e.op])).toEqual([['favorites:twinkle', 'put']])
  })

  it('tells this tab when they change, and nothing when a tap changes nothing', async () => {
    const heard: string[] = []
    const stop = library.page.favorites.onFavoritesChanged(() => heard.push('change'))
    await library.page.favorites.setFavorite('twinkle', true)
    await library.page.favorites.setFavorite('twinkle', true)
    stop()
    await library.page.favorites.setFavorite('twinkle', false)
    expect(heard).toEqual(['change'])
  })

  it("sends each to the account, naming the library's account, and isn't counted as a fart", async () => {
    claimedBy('user-a')
    await library.page.favorites.setFavorite('twinkle', true)
    await library.page.favorites.setFavorite('mary', true)
    await library.page.favorites.setFavorite('ode', true)
    await library.page.favorites.setFavorite('ode', false)
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.favorites()).toEqual(['mary', 'twinkle'])
    expect(await outbox()).toEqual([])
    expect(
      library.account.sent
        .filter(s => s.path.startsWith('/api/favorites/'))
        .map(s => `${s.method} ${s.path} ${s.library}`)
        .sort()
    ).toEqual(['PUT /api/favorites/mary/ user-a', 'PUT /api/favorites/twinkle/ user-a'])
  })

  it('sends a tap made while the last one was on its way', async () => {
    claimedBy('user-a')
    await library.page.favorites.setFavorite('twinkle', true)
    library.account.intercept = async sent => {
      if (sent.method !== 'PUT') return undefined
      library.account.intercept = null
      await library.page.favorites.setFavorite('twinkle', false)
      return undefined
    }
    await library.page.sync.syncOnce('user-a')
    expect(library.account.favorites()).toEqual([])
    expect(await favorites()).toEqual([])
    expect(await outbox()).toEqual([])
  })

  it('keeps a tap queued while the account is unreachable, and drops one refused at the limit', async () => {
    claimedBy('user-a')
    await library.page.favorites.setFavorite('twinkle', true)
    library.account.offline = true
    await library.page.sync.syncOnce('user-a')
    expect(await outbox()).toHaveLength(1)
    library.account.offline = false
    await library.page.sync.syncOnce('user-a')
    expect(library.account.favorites()).toEqual(['twinkle'])
    expect(await outbox()).toEqual([])

    await library.page.favorites.setFavorite('mary', true)
    refuse('PUT', 409, 'limit_reached')
    await library.page.sync.syncOnce('user-a')
    expect(await outbox()).toEqual([])
    library.account.intercept = null
    const before = library.account.sent.length
    await library.page.sync.syncOnce('user-a')
    expect(library.account.sent.slice(before).filter(s => s.method === 'PUT')).toEqual([])
    expect(library.account.favorites()).toEqual(['twinkle'])
  })

  it("brings another browser's, and takes off what it took off, telling the screens", async () => {
    claimedBy('user-a')
    library.account.setFavorite('twinkle', true)
    library.account.setFavorite('mary', true)
    const heard: string[] = []
    library.page.favorites.onFavoritesChanged(() => heard.push('change'))
    await library.page.sync.syncOnce('user-a')
    expect(await favorites()).toEqual(['mary', 'twinkle'])
    expect(heard).toEqual(['change'])

    library.account.setFavorite('mary', false)
    await library.page.sync.syncOnce('user-a')
    expect(await favorites()).toEqual(['twinkle'])
    await library.page.sync.syncOnce('user-a')
    expect(heard).toEqual(['change', 'change'])
  })

  it('keeps a tap this browser is still sending over what the account read', async () => {
    claimedBy('user-a')
    library.account.setFavorite('twinkle', true)
    await library.page.sync.syncOnce('user-a')
    library.account.offline = true
    await library.page.favorites.setFavorite('twinkle', false)
    await library.page.favorites.setFavorite('mary', true)
    library.account.offline = false
    library.account.setFavorite('mary', false)
    library.account.intercept = sent => (sent.method === 'GET' ? undefined : Response.error())
    await library.page.sync.syncOnce('user-a')
    expect(await favorites()).toEqual(['mary'])
  })

  it("drops what the account no longer has after a full read, but not what's waiting to send", async () => {
    claimedBy('user-a')
    library.account.setFavorite('twinkle', true)
    library.account.setFavorite('mary', true)
    await library.page.sync.syncOnce('user-a')
    library.account.offline = true
    await library.page.favorites.setFavorite('ode', true)
    library.account.offline = false
    library.account.setFavorite('mary', false)
    library.account.expireTombstones()
    library.account.advance(31 * 24 * 60 * 60 * 1000)
    library.account.intercept = sent => (sent.method === 'GET' ? undefined : Response.error())
    await library.page.sync.syncOnce('user-a')
    expect(await favorites()).toEqual(['ode', 'twinkle'])
  })

  it('changes none after a read from a Worker from before #313, which sends none', async () => {
    claimedBy('user-a')
    await library.page.favorites.setFavorite('twinkle', true)
    await library.page.sync.syncOnce('user-a')
    const older = async (sent: { method: string; path: string }) => {
      if (sent.method !== 'GET') return undefined
      library.account.intercept = null
      const answer: LibraryChanges = await (await library.account.fetch(sent.path)).json()
      const { favorites: _, deleted, ...read } = answer
      library.account.intercept = older
      const { favorites: __, ...deletedBefore } = deleted
      return Response.json({ ...read, full: true, deleted: deletedBefore })
    }
    library.account.intercept = older
    await library.page.sync.syncOnce('user-a')
    expect(await favorites()).toEqual(['twinkle'])
  })

  it('go with the library at sign-out, and with another account’s claim', async () => {
    await library.page.sync.claimLibrary('user-a', 'a@example.com')
    await library.page.favorites.setFavorite('twinkle', true)
    await library.page.sync.forgetLibrary()
    expect(await favorites()).toEqual([])

    await library.page.sync.claimLibrary('user-a', 'a@example.com')
    await library.page.favorites.setFavorite('mary', true)
    await library.page.sync.claimLibrary('user-b', 'b@example.com')
    expect(await favorites()).toEqual([])
    expect(await outbox()).toEqual([])
  })
  it('sends a name and a Favorite Song queued together, each alone', async () => {
    claimedBy('user-a')
    const mine = await recorded(1)
    await library.page.sync.syncOnce('user-a')
    library.account.place(mine.id, 45)
    await library.page.store.placeRecording(mine.id, { name: 'Squeaker' })
    await library.page.favorites.setFavorite('twinkle', true)
    await library.page.sync.syncOnce('user-a')
    expect(requests('PATCH').map(s => s.json)).toEqual([{ name: 'Squeaker' }])
    expect(library.account.favorites()).toEqual(['twinkle'])
    expect(library.account.get('recordings', mine.id)?.item).toMatchObject({
      placedPitch: 45,
      name: 'Squeaker'
    })
    expect(await outbox()).toEqual([])
  })
})

describe('a guest who favorites Songs, then signs in (#313)', () => {
  it('keeps them over the next visit, and sends them to the account once it is theirs', async () => {
    await library.page.favorites.setFavorite('twinkle', true)
    await library.page.favorites.setFavorite('mary', true)
    await library.page.favorites.setFavorite('ode', true)
    await library.page.favorites.setFavorite('ode', false)
    await recorded(1)
    library.account.setFavorite('jingle', true)
    library.account.setFavorite('ode', true)
    await library.page.store.clearVisit(new Set())
    expect(await library.page.store.loadRecordings()).toEqual([])
    expect((await library.page.favorites.loadFavorites()).sort()).toEqual(['mary', 'twinkle'])
    expect(library.account.sent).toEqual([])

    expect(await library.page.sync.claimLibrary('user-a', 'a@example.com')).toBe(true)
    await library.page.sync.syncOnce('user-a')

    expect(library.account.favorites()).toEqual(['jingle', 'mary', 'ode', 'twinkle'])
    expect((await library.page.favorites.loadFavorites()).sort()).toEqual([
      'jingle',
      'mary',
      'ode',
      'twinkle'
    ])
    expect(await outbox()).toEqual([])
  })
})
