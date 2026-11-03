import { catalogPath } from './catalog-path.generated'
import type { Song, SongNotes, SongSummary } from './song'

let loading: Promise<readonly SongSummary[]> | null = null
const songs = new Map<string, Promise<Song>>()

export function loadSongs(): Promise<readonly SongSummary[]> {
  loading ??= fetchSongs().catch(error => {
    loading = null
    throw error
  })
  return loading
}

export function loadSong(song: SongSummary): Promise<Song> {
  let loaded = songs.get(song.notesPath)
  if (!loaded) {
    loaded = fetchNotes(song).catch(error => {
      songs.delete(song.notesPath)
      throw error
    })
    songs.set(song.notesPath, loaded)
  }
  return loaded
}

async function fetchSongs(): Promise<readonly SongSummary[]> {
  const songs: unknown = await fetchJson(catalogPath, 'The Song Catalog')
  if (!Array.isArray(songs)) throw new Error("The Song Catalog isn't a list")
  return songs as readonly SongSummary[]
}

async function fetchNotes(song: SongSummary): Promise<Song> {
  const notes = (await fetchJson(song.notesPath, `${song.title}'s notes`)) as SongNotes | null
  if (!Array.isArray(notes?.notes)) throw new Error(`${song.title}'s notes aren't a melody`)
  return { ...song, ...notes }
}

async function fetchJson(path: string, what: string): Promise<unknown> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${what} answered ${response.status}`)
  return await response.json()
}
