/** The longest a slug is, before any `-2`. The catalog's longest title is 51 characters. */
const MAX_LENGTH = 80

/**
 * `text` as a link's last segment: "Twinkle, Twinkle, Little Star" is
 * "twinkle-twinkle-little-star", and "Für Elise" is "fur-elise". Or `fallback`, for text with no
 * letter or digit it can keep. Cut at a hyphen when it's too long.
 */
export function slugify(text: string, fallback: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= MAX_LENGTH) return slug || fallback
  const cut = slug.slice(0, MAX_LENGTH + 1)
  const hyphen = cut.lastIndexOf('-')
  return hyphen > 0 ? cut.slice(0, hyphen) : slug.slice(0, MAX_LENGTH)
}

/** `base`, or else `base-2`, `base-3` and on: the first that isn't in `used`. */
export function freeSlug(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
