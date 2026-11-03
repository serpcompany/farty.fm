import type { HandleProblem } from './handle'
import { answer, send } from './library-api'
import { syncOnce } from './library-sync'

export async function readHandle(
  accountId: string
): Promise<{ handle: string | null; suggestion: string | null } | null> {
  const response = await send('/api/handle/', accountId)
  if (!response?.ok) return null
  return response.json()
}

export async function checkHandle(
  handle: string,
  accountId: string
): Promise<HandleProblem | null | 'unreachable'> {
  const response = await send(`/api/handle/?check=${encodeURIComponent(handle)}`, accountId)
  if (!response?.ok) return 'unreachable'
  return ((await response.json()) as { problem: HandleProblem | null }).problem
}

export type PickedHandle = { handle: string } | { problem: HandleProblem } | { failed: true }

export async function pickHandle(handle: string, accountId: string): Promise<PickedHandle> {
  const response = await send('/api/handle/', accountId, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle })
  })
  if (!response) return { failed: true }
  const body = (await response.json().catch(() => null)) as {
    handle?: string
    error?: string
    problem?: HandleProblem
  } | null
  if (response.status === 201 && body?.handle) return { handle: body.handle }
  if (body?.error === 'has_handle' && body.handle) return { handle: body.handle }
  if (body?.error === 'handle_taken') return { problem: 'taken' }
  if (body?.error === 'handle_unusable' && body.problem) return { problem: body.problem }
  return { failed: true }
}

export type ShareKind = 'recordings' | 'toots'

export type Shares = {
  handle: string | null
  links: ReadonlyMap<string, string>
  tootLinks: ReadonlyMap<string, string>
}

export function shareLink(shares: Shares | null, kind: ShareKind, id: string): string | null {
  return (kind === 'toots' ? shares?.tootLinks : shares?.links)?.get(id) ?? null
}

export async function readShares(accountId: string): Promise<Shares | null> {
  const response = await send('/api/share/', accountId)
  if (!response?.ok) return null
  const body = (await response.json()) as {
    handle: string | null
    shares: { kind: string; itemId: string; url: string }[]
  }
  const linksOf = (kind: ShareKind) =>
    new Map(body.shares.filter(share => share.kind === kind).map(s => [s.itemId, s.url]))
  return { handle: body.handle, links: linksOf('recordings'), tootLinks: linksOf('toots') }
}

export type Shared =
  | { url: string }
  | { error: 'noHandle' | 'notUploaded' | 'takenDown' | 'deleted' | 'failed' }

const UPLOAD_TRIES = 4
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function shareItem(kind: ShareKind, id: string, accountId: string): Promise<Shared> {
  for (let tries = 1; ; tries++) {
    const response = await send(`/api/share/${kind}/${id}/`, accountId, { method: 'PUT' })
    if (response?.ok) return { url: ((await response.json()) as { url: string }).url }
    const { status, error } = await answer(response)
    if (error === 'no_handle') return { error: 'noHandle' }
    if (error === 'taken_down') return { error: 'takenDown' }
    if (status === 410) return { error: 'deleted' }
    if (status !== 404) return { error: 'failed' }
    if (tries === UPLOAD_TRIES) return { error: 'notUploaded' }
    await syncOnce(accountId).catch(() => {})
    await wait(500 * tries)
  }
}

export async function stopSharing(
  kind: ShareKind,
  id: string,
  accountId: string
): Promise<boolean> {
  const response = await send(`/api/share/${kind}/${id}/`, accountId, { method: 'DELETE' })
  return response?.status === 204
}

export async function offerLink(
  url: string,
  title: string
): Promise<'shared' | 'copied' | 'cancelled' | 'needsTap'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
        return copyLink(url)
      }
      return 'needsTap'
    }
  }
  return copyLink(url)
}

async function copyLink(url: string): Promise<'copied' | 'needsTap'> {
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'needsTap'
  }
}
