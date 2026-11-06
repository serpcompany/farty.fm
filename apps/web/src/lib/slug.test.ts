import { describe, expect, it } from 'vitest'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { freeSlug, slugify } from './slug'

describe('slugify', () => {
  it.each([
    ['I Saw Three Ships', 'i-saw-three-ships'],
    ['Twinkle, Twinkle, Little Star', 'twinkle-twinkle-little-star'],
    ['Für Elise', 'fur-elise'],
    ["Auld Lang Syne's", 'auld-lang-synes'],
    ['Recording 3', 'recording-3'],
    ['  --Sound Pad--  ', 'sound-pad']
  ])('%s is %s', (text, slug) => {
    expect(slugify(text, 'toot')).toBe(slug)
  })

  it('falls back when nothing is left', () => {
    expect(slugify('屁!', 'toot')).toBe('toot')
    expect(slugify('', 'recording')).toBe('recording')
  })

  it('cuts a long title at a hyphen', () => {
    const slug = slugify(`${'word '.repeat(30)}end`, 'toot')
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('word')).toBe(true)
    expect(slugify('x'.repeat(200), 'toot')).toHaveLength(80)
  })

  it('gives every Song in the catalog its own slug', () => {
    const slugs = songIndex.map(song => slugify(song.title, 'toot'))
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })
})

describe('freeSlug', () => {
  it('takes the first that is free', () => {
    expect(freeSlug('ships', new Set())).toBe('ships')
    expect(freeSlug('ships', new Set(['ships']))).toBe('ships-2')
    expect(freeSlug('ships', new Set(['ships', 'ships-2']))).toBe('ships-3')
  })
})
