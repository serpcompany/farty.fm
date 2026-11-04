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
