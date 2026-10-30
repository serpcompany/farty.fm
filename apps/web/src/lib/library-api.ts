import type { Kind } from './outbox'
import type { Recording, Trim } from './recordings'
import type { Toot } from './toot'

// The account's library, from the browser: the routes in `src/app/api/` (`src/server/library.ts`).
// Every call is same-origin, so the browser sends the session cookie and its own Origin, and names
// the account the library is (`accountId`): the server refuses one that isn't the session's (409
// `wrong_account`). Each answers its status, or 0 when Farty couldn't be reached in time.

/** How long one request may take before it counts as unreachable: a Toot's WAV is up to 16 MB. */
const REQUEST_TIMEOUT_MS = 60_000

/** The header each call names its library's account in (`LIBRARY_HEADER` on the server). */
const LIBRARY_HEADER = 'x-pedos-library'

export type Answer = { status: number; error?: string }

export async function send(
  path: string,
  accountId: string,
  init: RequestInit = {}
): Promise<Response | null> {
  // Not `AbortSignal.timeout`: a timer the tests can run.
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS)
  const headers = new Headers(init.headers)
  headers.set(LIBRARY_HEADER, accountId)
  try {
    return await fetch(path, { ...init, headers, cache: 'no-store', signal: timeout.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function answer(response: Response | null): Promise<Answer> {
  if (!response) return { status: 0 }
  if (response.ok) return { status: response.status }
  const error = await response
    .json()
    .then(body => (body as { error?: unknown } | null)?.error)
    .catch(() => undefined)
  return typeof error === 'string'
    ? { status: response.status, error }
    : { status: response.status }
}

/** Uploads a Recording or Toot and its WAV, as `accountId`'s library. */
export async function putItem(
  kind: Kind,
  item: Recording | Toot,
  wav: ArrayBuffer,
  accountId: string
): Promise<Answer> {
  const form = new FormData()
  form.set('metadata', JSON.stringify(item))
  form.set('audio', new Blob([wav], { type: 'audio/wav' }), `${item.id}.wav`)
  return answer(await send(`/api/${kind}/${item.id}/`, accountId, { method: 'PUT', body: form }))
}

export async function renameToot(id: string, title: string, accountId: string): Promise<Answer> {
  return answer(
    await send(`/api/toots/${id}/`, accountId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title })
    })
  )
}

/** A Recording's Placed Pitch (ADR 0015) and Trim (ADR 0019), as this browser has them now. */
export type Placement = { placedPitch: number | null; trim: Trim | null }

/** Places a Recording on a note by ear and trims it, or takes either off with null. */
export async function placeRecording(
  id: string,
  placement: Placement,
  accountId: string
): Promise<Answer> {
  return answer(
    await send(`/api/recordings/${id}/`, accountId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(placement)
    })
  )
}

export async function deleteItem(kind: Kind, id: string, accountId: string): Promise<Answer> {
  return answer(await send(`/api/${kind}/${id}/`, accountId, { method: 'DELETE' }))
}

/** What `GET /api/library/` answers: the changes since `since`, or the whole library (`full`). */
export type LibraryChanges = {
  cursor: number
  full: boolean
  recordings: (Recording & { audioBytes?: number })[]
  toots: (Toot & { audioBytes?: number })[]
  deleted: { recordings: string[]; toots: string[] }
}

export async function getLibrary(
  since: number,
  accountId: string
): Promise<LibraryChanges | Answer> {
  const response = await send(`/api/library/?since=${since}`, accountId)
  if (!response?.ok) return answer(response)
  try {
    return (await response.json()) as LibraryChanges
  } catch {
    return { status: 0 }
  }
}

/** A Recording's or Toot's WAV, as the account keeps it. */
export async function getAudio(
  kind: Kind,
  id: string,
  accountId: string
): Promise<ArrayBuffer | Answer> {
  const response = await send(`/api/${kind}/${id}/audio/`, accountId)
  if (!response?.ok) return answer(response)
  try {
    return await response.arrayBuffer()
  } catch {
    return { status: 0 }
  }
}
