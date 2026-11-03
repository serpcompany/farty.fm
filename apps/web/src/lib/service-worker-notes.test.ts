import { describe, expect, it, vi } from 'vitest'
import { catalog, failed, ok, origin, startPage, startWorker } from '@/test-support/service-worker'

describe("a Song's notes (#323)", () => {
  const notes = (id: string) => `/catalog/notes/${id}-0123456789abcdef.json`

  it('keeps the notes of each Song opened, in a cache of their own, and plays them offline', async () => {
    let online = true
    const worker = startWorker(url =>
      online ? ok(`notes of ${url.replace(origin, '')}`) : 'offline'
    )
    expect(await (await worker.request(notes('mary')))?.text()).toBe(`notes of ${notes('mary')}`)
    expect(worker.kept('pedos-notes-v1')).toEqual([notes('mary')])
    expect(worker.kept()).toEqual([])

    online = false
    expect(await (await worker.request(notes('mary')))?.text()).toBe(`notes of ${notes('mary')}`)
  })

  const index = (...ids: string[]) =>
    JSON.stringify(ids.map(id => ({ id, title: id, notesPath: notes(id) })))

  const shellOrIndex = (path: string, answerTheIndex: () => Response | 'offline') => {
    if (path === '/') return ok(startPage)
    if (path === '/shell.json') return ok(JSON.stringify({ pages: ['/compose/song/'] }))
    if (path === '/compose/song/') return ok(`<link rel="preload" href="${catalog}" as="fetch"/>`)
    if (path === catalog) return answerTheIndex()
    return null
  }

  it("keeps every Song's notes once it's active, so a Song never opened plays offline (#138)", async () => {
    let online = true
    const fetched: string[] = []
    const worker = startWorker(url => {
      if (!online) return 'offline'
      const path = url.replace(origin, '')
      fetched.push(path)
      return (
        shellOrIndex(path, () => ok(index('mary', 'twinkle', 'ode-to-joy'))) ??
        ok(`notes of ${path}`)
      )
    })
    await worker.lifecycle('install')
    expect(worker.kept()).toContain(catalog)
    expect(worker.kept('pedos-notes-v1')).toEqual([])
    await worker.lifecycle('activate')
    await vi.waitFor(() =>
      expect(worker.kept('pedos-notes-v1').sort()).toEqual(
        [notes('mary'), notes('ode-to-joy'), notes('twinkle')].sort()
      )
    )
    expect(worker.kept().filter(path => path.startsWith('/catalog/notes/'))).toEqual([])

    online = false
    expect(await (await worker.request(notes('twinkle')))?.text()).toBe(
      `notes of ${notes('twinkle')}`
    )

    online = true
    fetched.length = 0
    await worker.request('/', { mode: 'navigate' })
    expect(fetched.filter(path => path.startsWith('/catalog/notes/'))).toEqual([])
  })

  it("installs and activates without waiting on the notes, so a new build's worker takes over at once (#350)", async () => {
    const fetched: string[] = []
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      const shellFile = shellOrIndex(path, () => ok(index('mary', 'twinkle')))
      if (shellFile) return shellFile
      fetched.push(path)
      return path.startsWith('/catalog/notes/') ? new Promise<Response>(() => {}) : ok()
    })
    await worker.lifecycle('install')
    expect(fetched.filter(path => path.startsWith('/catalog/notes/'))).toEqual([])
    await worker.lifecycle('activate')
    await vi.waitFor(() =>
      expect(fetched.filter(path => path.startsWith('/catalog/notes/')).sort()).toEqual([
        notes('mary'),
        notes('twinkle')
      ])
    )
  })

  it("keeps the index's notes on a page's fetch of it when install couldn't fetch it", async () => {
    let indexOnline = false
    const fetched: string[] = []
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      fetched.push(path)
      const indexAnswer = () => (indexOnline ? ok(index('mary', 'twinkle')) : 'offline')
      return shellOrIndex(path, indexAnswer) ?? ok(`notes of ${path}`)
    })
    await worker.lifecycle('install')
    await worker.lifecycle('activate')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fetched.filter(path => path.startsWith('/catalog/notes/'))).toEqual([])

    indexOnline = true
    await worker.request(catalog)
    expect(worker.kept('pedos-notes-v1').sort()).toEqual([notes('mary'), notes('twinkle')])
  })

  it("never trims the current index's notes, however many Songs it has", async () => {
    const songs = Array.from({ length: 1100 }, (_, i) => `song-${i}`)
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      if (path === catalog) return ok(index(...songs))
      return ok(`notes of ${path}`)
    })
    for (const song of songs) await worker.request(notes(song))
    for (let i = 0; i < 1500; i++) await worker.request(notes(`old-${i}`))
    await worker.request(catalog)
    const kept = new Set(worker.kept('pedos-notes-v1'))
    expect(songs.filter(song => !kept.has(notes(song)))).toEqual([])
    expect(kept.size).toBe(2 * songs.length)
  })

  it("keeps a new index's notes once a page fetches it, such as after a deploy", async () => {
    const next = '/catalog/songs-00000000000000ff.json'
    const fetched: string[] = []
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      fetched.push(path)
      if (path === catalog) return ok(index('mary'))
      if (path === next) return ok(index('mary', 'twinkle'))
      return ok(`notes of ${path}`)
    })
    expect(await (await worker.request(catalog))?.text()).toBe(index('mary'))
    expect(worker.kept('pedos-notes-v1')).toEqual([notes('mary')])
    await worker.request(next)
    expect(worker.kept('pedos-notes-v1')).toEqual([notes('mary'), notes('twinkle')])
    await worker.request(next)
    expect(fetched.filter(path => path === notes('mary'))).toHaveLength(1)
    expect(fetched.filter(path => path === notes('twinkle'))).toHaveLength(1)
  })

  it('tries the notes again on the next fetch of the index when the connection drops part way', async () => {
    let flaky = true
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      if (path === catalog) return ok(index('mary', 'twinkle'))
      if (flaky && path === notes('twinkle')) return 'offline'
      return ok(`notes of ${path}`)
    })
    await worker.request(catalog)
    expect(worker.kept('pedos-notes-v1')).toEqual([notes('mary')])
    flaky = false
    await worker.request(catalog)
    expect(worker.kept('pedos-notes-v1')).toEqual([notes('mary'), notes('twinkle')])
  })

  it("answers a Song's notes from before a deploy with the copy it kept", async () => {
    let deployed = false
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      return deployed && path.startsWith('/catalog/') ? failed(404) : ok(`first build's ${path}`)
    })
    await worker.request(notes('mary'))
    deployed = true
    expect(await (await worker.request(notes('mary')))?.text()).toBe(
      `first build's ${notes('mary')}`
    )
    expect((await worker.request(notes('twinkle')))?.status).toBe(404)
  })

  it('never pushes the shell out, however many Songs open', async () => {
    const worker = startWorker(() => ok('file'))
    await worker.request('/_next/static/chunks/main.js')
    for (let i = 0; i < 300; i++) await worker.request(notes(`song-${i}`))
    expect(worker.kept()).toEqual(['/_next/static/chunks/main.js'])
    expect(worker.kept('pedos-notes-v1')).toHaveLength(300)
  })

  it('leaves anything else under /catalog/notes/ to the network', async () => {
    const worker = startWorker(() => ok('file'))
    for (const path of ['/catalog/notes/mary.json', '/catalog/notes/Mary-0123456789abcdef.json']) {
      expect(await worker.request(path), path).toBeUndefined()
    }
  })
})
