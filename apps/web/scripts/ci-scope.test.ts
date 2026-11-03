import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  changedPaths,
  classify,
  docsOnlyChain,
  gitIn,
  isDoc,
  isDocsOnlyChange
} from './ci-scope.mjs'
import { removeScratchHistories, scratchHistory } from './scratch-history'

const root = new URL('../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

afterEach(removeScratchHistories)

describe('which changes are docs-only', () => {
  it("treats Markdown under docs/, at the root, in skills, in the web app's docs and agent files, in the tools' docs and beside the golden data as docs", () => {
    expect(
      isDocsOnlyChange([
        'AGENTS.md',
        'README.md',
        'docs/agents/ci.md',
        'docs/adr/0022-retire-the-iphone-app-source.md',
        '.claude/skills/verify-web/SKILL.md',
        'apps/web/docs/product/record.md',
        'apps/web/AGENTS.md',
        'apps/web/CLAUDE.md',
        'tools/melody-lab/README.md',
        'tools/catalog/picking.md',
        'fixtures/golden/files.md'
      ])
    ).toBe(true)
  })

  it('treats code, config, data beside the docs, the changelog, generated reports and an empty change as more than docs', () => {
    expect(isDocsOnlyChange([])).toBe(false)
    expect(isDocsOnlyChange(['docs/agents/ci.md', 'apps/web/src/server/library.ts'])).toBe(false)
    for (const path of [
      'verify.json',
      '.claude/settings.json',
      '.claude/skills/verify-web/serve.mjs',
      'docs/brand/farty-logo.svg',
      'apps/web/CHANGELOG.md',
      'apps/web/src/lib/catalog/notes.md',
      'tools/catalog/titles-01.report.md',
      'tools/catalog/ranking.md',
      'catalog/catalog.json'
    ]) {
      expect(isDoc(path), path).toBe(false)
    }
  })

  it('treats the two Markdown files a Python test reads as more than docs', () => {
    expect(isDoc('tools/catalog/README.md')).toBe(false)
    expect(isDoc('fixtures/golden/port-tests.md')).toBe(false)
    const test = read('tools/catalog/test_pdmx.py')
    expect(test).toContain('(ROOT / "fixtures/golden/port-tests.md").read_text')
    expect(test).toContain('(HERE / "README.md").read_text')
  })

  it('counts as docs no file that code, a test, a script, a workflow or a config names, beyond the rules and reasons in their text', () => {
    const tracked = gitIn(fileURLToPath(root))(['ls-files', '-z']).split('\0').filter(Boolean)
    const docs = tracked.filter(isDoc)
    const readers = tracked.filter(
      file =>
        /^(?:apps\/web\/(?:src|scripts|e2e)\/|tools\/.+\.py$|\.github\/|catalog\/.+\.json$)/.test(
          file
        ) ||
        (/^(?:apps\/web\/)?[^/]+$/.test(file) && !file.endsWith('.md'))
    )
    expect(docs).toContain('AGENTS.md')
    expect(readers).toContain('apps/web/src/server/library.ts')
    const named = readers
      .filter(file => file !== 'apps/web/scripts/ci-scope.test.ts')
      .flatMap(reader => {
        const text = readFileSync(new URL(reader, root), 'latin1')
        return docs
          .filter(doc => new RegExp(`(?:^|[^\\w/.-])${doc.replace(/\./g, '\\.')}`).test(text))
          .map(doc => `${reader} names ${doc}`)
      })
    const onlyInText = {
      '.github/workflows/claude.yml names AGENTS.md': "the rules Claude's @claude runs follow",
      '.github/workflows/claude.yml names ARCHITECTURE.md':
        "the rules Claude's @claude runs follow",
      '.github/workflows/claude.yml names CONTEXT.md': "the rules Claude's @claude runs follow",
      '.github/workflows/claude.yml names apps/web/AGENTS.md':
        "the rules Claude's @claude runs follow",
      '.github/workflows/claude.yml names docs/agents/ci.md': 'its notices, which link the doc',
      '.github/workflows/claude.yml names docs/agents/code.md':
        "the rules Claude's @claude runs follow",
      '.github/workflows/code-review.yml names AGENTS.md':
        'the rules the review reads, which runs on a docs-only change',
      '.github/workflows/code-review.yml names ARCHITECTURE.md': 'the rules the review reads',
      '.github/workflows/code-review.yml names CONTEXT.md': 'the rules the review reads',
      '.github/workflows/code-review.yml names apps/web/AGENTS.md': 'the rules the review reads',
      '.github/workflows/code-review.yml names docs/agents/code.md': 'the rules the review reads',
      '.github/workflows/maintenance.yml names AGENTS.md': "the weekly doc gardener's prompt",
      '.github/workflows/maintenance.yml names docs/agents/ci.md':
        "the weekly doc gardener's prompt",
      '.github/workflows/maintenance.yml names docs/agents/code.md':
        "the weekly doc gardener's prompt",
      '.github/workflows/maintenance.yml names docs/agents/exceptions.md':
        "the weekly doc gardener's prompt",
      '.github/workflows/repository.yml names docs/agents/ci.md': "an install error's pointer",
      'apps/web/biome.json names docs/agents/web-gotchas.md': "a lint rule's message",
      'apps/web/scripts/docs-report.test.ts names README.md': 'paths in its fixtures, never read',
      'apps/web/scripts/docs-report.test.ts names docs/adr/0022-retire-the-iphone-app-source.md':
        'paths in its fixtures, never read',
      'apps/web/scripts/docs-report.test.ts names docs/agents/ci.md':
        'paths in its fixtures, never read',
      'apps/web/scripts/docs-report.test.ts names docs/agents/web.md':
        'paths in its fixtures, never read',
      'tools/catalog/test_pdmx.py names README.md':
        "its own folder's README, tools/catalog/README.md, which isn't a doc",
      'verify.json names .claude/skills/pr-review/SKILL.md':
        'the docs check, which runs on a docs-only change',
      'verify.json names ARCHITECTURE.md': 'the docs check, which runs on a docs-only change',
      'verify.json names docs/agents/code.md': "an exception's reason"
    }
    expect(named.sort()).toEqual(Object.keys(onlyInText).sort())
  })

  it('holds Tailwind to src, so a docs-only change leaves the CSS alone', () => {
    const css = read('apps/web/src/app/globals.css')
    expect(css).toMatch(/^@import "tailwindcss" source\(none\);$/m)
    expect([...css.matchAll(/^@source "([^"]+)";$/gm)].map(([, source]) => source)).toEqual(['..'])
  })
})

describe('classifying a change in a history', () => {
  it('lists a renamed file under its old path too, so moving code into docs runs everything', () => {
    const { git, commit, move } = scratchHistory()
    commit('src/a.ts')
    const before = git(['rev-parse', 'HEAD']).trim()
    move('src/a.ts', 'docs/a.md')
    expect(changedPaths(git, before, 'HEAD').sort()).toEqual(['docs/a.md', 'src/a.ts'])
    expect(classify(git, before).docs).toBe(false)
  })

  it('runs everything with no earlier commit to compare with, as on a new branch', () => {
    const { git, commit } = scratchHistory()
    commit('docs/a.md')
    expect(classify(git, '').docs).toBe(false)
    expect(classify(git, '0'.repeat(40)).docs).toBe(false)
  })

  it('finds a docs-only commit, and walks back past docs-only commits to the last that changed more', () => {
    const { git, commit } = scratchHistory()
    const code = commit('src/a.ts')
    const docs = commit('docs/a.md')
    const skill = commit('.claude/skills/a/SKILL.md', 'README.md')
    expect(classify(git, code, skill).docs).toBe(true)
    expect(docsOnlyChain(git, skill)).toEqual([skill, docs, code])
    expect(docsOnlyChain(git, code)).toEqual([code])
    expect(docsOnlyChain(git, skill, 1)).toBeNull()
  })
})
