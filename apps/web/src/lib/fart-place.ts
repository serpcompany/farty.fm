// Where a Recording was made (#444, ADR 0020): the owner asked for it because it's funny, and a
// shared page is public, so it's never finer than a city. It comes from Cloudflare's reading of the
// connection that uploaded the Recording, with no browser prompt, so a VPN gives the VPN's city.

/** What's kept of where a Recording was first uploaded from. Never an address or a position. */
export type RecordedPlace = {
  city: string | null
  /** The state, in the US. Elsewhere a page names the country instead, so none is kept. */
  region: string | null
  /** "US": never null, since a place with no country isn't kept. */
  country: string
  /** "America/Chicago", for the time there. */
  timeZone: string | null
}

/** What a shared page says of where a Recording was made. */
export type RecordedIn = {
  /** "Austin, Texas", or null when it says nothing. */
  recordedIn: string | null
  /** The time zone it says the time in, or null for the viewer's own. */
  timeZone: string | null
}

/** A page that says nothing of where: a place never kept, or the owner's switch off. */
export const NOT_SAID: RecordedIn = { recordedIn: null, timeZone: null }

/** Cloudflare's country codes that name none: Tor, and unknown. */
const NO_COUNTRY = new Set(['T1', 'XX'])

const textOf = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * The fields kept from a request's Cloudflare properties, and only those: never its coordinates,
 * postal code or metro code. Null when they name no country.
 */
export function recordedPlaceOf(cf: unknown): RecordedPlace | null {
  if (typeof cf !== 'object' || cf === null) return null
  const { city, region, country, timezone } = cf as Record<string, unknown>
  const code = textOf(country)
  if (code === null || NO_COUNTRY.has(code)) return null
  return {
    city: textOf(city),
    region: code === 'US' ? textOf(region) : null,
    country: code,
    timeZone: textOf(timezone)
  }
}

/** "France" for "FR", or null for a code this runtime can't name. */
function countryName(code: string): string | null {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code) ?? null
  } catch {
    return null
  }
}

/** "Austin, Texas" in the US, "Paris, France" elsewhere, or as much of either as is known. */
export function recordedInOf(place: RecordedPlace | null): RecordedIn {
  if (!place) return NOT_SAID
  const wider = place.region ?? countryName(place.country)
  // "Singapore", not "Singapore, Singapore".
  const name = place.city && place.city !== wider ? [place.city, wider] : [wider]
  const recordedIn = name.filter(Boolean).join(', ')
  return recordedIn ? { recordedIn, timeZone: place.timeZone } : NOT_SAID
}

/**
 * "Nov 6, 2026, 3:12 PM · Austin, Texas": when a Recording was made, in the time where it was made,
 * or in the viewer's own time when the page says nothing of where. Without `time`, only the day,
 * "Nov 6, 2026 · Austin, Texas", for a row with room for one short line (#451).
 */
export function recordedWhenAndWhere(
  recordedAt: number,
  { recordedIn, timeZone }: RecordedIn,
  { time = true }: { time?: boolean } = {}
): string {
  const style = time
    ? ({ dateStyle: 'medium', timeStyle: 'short' } as const)
    : ({ dateStyle: 'medium' } as const)
  const at = new Date(recordedAt)
  let when: string
  try {
    when = at.toLocaleString(undefined, timeZone ? { ...style, timeZone } : style)
  } catch {
    // A time zone this browser doesn't know.
    when = at.toLocaleString(undefined, style)
  }
  return recordedIn ? `${when} · ${recordedIn}` : when
}
