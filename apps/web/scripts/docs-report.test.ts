import { describe, expect, it } from 'vitest'
import {
  docReferences,
  docsToReverify,
  isGardenedDoc,
  lastChangeTimes,
  renderReport
} from './docs-report'

const tracked = new Set([
  'README.md',
  'docs/agents/web.md',
  'docs/agents/ci.md',
  'apps/web/src/server/library.ts',
  'apps/web/wrangler.jsonc',
  '.github/workflows/web.yml',
  'apps/web/scripts/smoke.sh',
  'tools/scripts/smoke.sh'
])

describe('lastChangeTimes', () => {
  it("keeps each path's newest commit time from git log, newest first", () => {
    const log =
      '\u00002000\n\ndocs/agents/web.md\napps/web/wrangler.jsonc\n\u00001000\n\ndocs/agents/web.md\n'
    expect(lastChangeTimes(log)).toEqual(
      new Map([
        ['docs/agents/web.md', 2000],
        ['apps/web/wrangler.jsonc', 2000]
      ])
    )
  })
})

describe('isGardenedDoc', () => {
  it('leaves out ADRs and changelogs, which record history, and generated reports', () => {
    expect(isGardenedDoc('docs/agents/web.md')).toBe(true)
    expect(isGardenedDoc('docs/adr/0016-retire-the-iphone-app-source.md')).toBe(false)
    expect(isGardenedDoc('apps/web/CHANGELOG.md')).toBe(false)
    expect(isGardenedDoc('tools/catalog/titles-01.report.md')).toBe(false)
    expect(isGardenedDoc('apps/web/src/server/library.ts')).toBe(false)
  })
})

describe('docReferences', () => {
  it('finds the files a doc links or names, from its folder, the root or a unique ending', () => {
    const text = [
      'The Worker is [configured](../../apps/web/wrangler.jsonc "wrangler") here.',
      'Limits are in `src/server/library.ts:50`, and deploys in `.github/workflows/web.yml`.'
    ].join('\n')
    expect(docReferences('docs/agents/web.md', text, tracked)).toEqual([
      '.github/workflows/web.yml',
      'apps/web/src/server/library.ts',
      'apps/web/wrangler.jsonc'
    ])
  })

  it('leaves out other docs, folders, outside links, and names that match no file or several', () => {
    const text = [
      'See [CI](ci.md#required-checks), [the readme](../../README.md) and `docs/agents/`.',
      '[SERP](https://github.com/serpcompany/serp) [mail](mailto:support@farty.fm)',
      '`pnpm check` `missing/file.ts` `web.yml` `LIMITS` `scripts/smoke.sh`'
    ].join('\n')
    expect(docReferences('docs/agents/web.md', text, tracked)).toEqual([])
  })
})

describe('docsToReverify', () => {
  const times = new Map([
    ['docs/agents/web.md', 100],
    ['docs/agents/ci.md', 300],
    ['README.md', 50],
    ['apps/web/wrangler.jsonc', 200],
    ['apps/web/src/server/library.ts', 150],
    ['.github/workflows/web.yml', 300]
  ])

  it('lists a doc whose named files changed after it, the most changed first', () => {
    expect(
      docsToReverify(
        [
          { doc: 'README.md', references: ['.github/workflows/web.yml'] },
          {
            doc: 'docs/agents/web.md',
            references: ['apps/web/wrangler.jsonc', 'apps/web/src/server/library.ts']
          },
          { doc: 'docs/agents/ci.md', references: ['.github/workflows/web.yml'] }
        ],
        times
      )
    ).toEqual([
      {
        doc: 'docs/agents/web.md',
        changed: ['apps/web/wrangler.jsonc', 'apps/web/src/server/library.ts']
      },
      { doc: 'README.md', changed: ['.github/workflows/web.yml'] }
    ])
  })

  it('leaves out a doc edited in the same commit as the file it names', () => {
    expect(
      docsToReverify(
        [{ doc: 'docs/agents/ci.md', references: ['.github/workflows/web.yml'] }],
        times
      )
    ).toEqual([])
  })
})

describe('renderReport', () => {
  it('lists five changed files a doc and counts the rest', () => {
    const changed = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts']
    expect(renderReport([{ doc: 'README.md', changed }], '2026-10-28')).toContain(
      '- `README.md`: `a.ts`, `b.ts`, `c.ts`, `d.ts`, `e.ts`, and 2 more'
    )
  })

  it('says None when every doc is current', () => {
    expect(renderReport([], '2026-10-28')).toContain('\nNone.\n')
  })
})
