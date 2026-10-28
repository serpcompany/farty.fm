import type { Kind } from './outbox'
import type { Recording } from './recordings'
import { withinTimeout } from './timeout'
import type { Toot } from './toot'

const REQUEST_TIMEOUT_MS = 60_000

const LIBRARY_HEADER = 'x-pedos-library'

export type Answer = { status: number; error?: string }

export async function send(
  path: string,
  accountId: string,
  init: RequestInit = {}
): Promise<Response | null> {
  const headers = new Headers(init.headers)
  headers.set(LIBRARY_HEADER, accountId)
  try {
    return await withinTimeout(REQUEST_TIMEOUT_MS, signal =>
      fetch(path, { ...init, headers, cache: 'no-store', signal })
    )
  } catch {
    return null
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

async function patch(path: string, accountId: string, fields: object): Promise<Answer> {
  return answer(
    await send(path, accountId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields)
    })
  )
}

export function renameToot(id: string, title: string, accountId: string): Promise<Answer> {
  return patch(`/api/toots/${id}/`, accountId, { title })
}

export function placeRecording(
  id: string,
  placedPitch: number | null,
  accountId: string
): Promise<Answer> {
  return patch(`/api/recordings/${id}/`, accountId, { placedPitch })
}

export async function deleteItem(kind: Kind, id: string, accountId: string): Promise<Answer> {
  return answer(await send(`/api/${kind}/${id}/`, accountId, { method: 'DELETE' }))
}

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
