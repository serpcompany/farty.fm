import { segmentHandle } from '@/lib/handle'

/**
 * A page's params with the Handle its `[atHandle]` segment names: `@maya` gives `maya` (#382).
 * A segment with no `@` gives '', which no lookup finds, so `/maya/` and the routes under it are
 * no one's.
 */
export async function linkParams<P extends { atHandle: string }>(
  params: Promise<P>
): Promise<Omit<P, 'atHandle'> & { handle: string }> {
  const { atHandle, ...rest } = await params
  return { ...rest, handle: segmentHandle(atHandle) ?? '' }
}

/** `path` with the query its page was asked for, as the `/u/` redirects keep it (`next.config.ts`). */
export async function withQuery(
  path: string,
  searchParams: Promise<Record<string, string | string[] | undefined>>
): Promise<string> {
  const query = new URLSearchParams()
  for (const [name, values] of Object.entries(await searchParams)) {
    for (const value of [values ?? []].flat()) query.append(name, value)
  }
  return query.size > 0 ? `${path}?${query}` : path
}
