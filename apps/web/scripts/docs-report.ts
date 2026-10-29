import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'

export type StaleDoc = { doc: string; changed: string[] }

const SKIPPED_DOCS = [/^docs\/adr\//, /(^|\/)CHANGELOG\.md$/, /\.report\.md$/]
const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const CODE = /`([^`\s]+)`/g
const LINE_NUMBERS = /:\d+(-\d+)?$/
const SHOWN = 5

export function lastChangeTimes(log: string): Map<string, number> {
  const times = new Map<string, number>()
  for (const record of log.split('\0')) {
    const [time, ...paths] = record.split('\n').filter(Boolean)
    const seconds = Number(time)
    if (!Number.isFinite(seconds)) continue
    for (const path of paths) if (!times.has(path)) times.set(path, seconds)
  }
  return times
}

export function isGardenedDoc(path: string): boolean {
  return path.endsWith('.md') && !SKIPPED_DOCS.some(skipped => skipped.test(path))
}

function resolveReference(
  doc: string,
  target: string,
  tracked: ReadonlySet<string>
): string | null {
  const bare = target.replace(LINE_NUMBERS, '')
  if (!bare || bare.endsWith('/') || bare.endsWith('.md')) return null
  const candidates = [posix.normalize(posix.join(posix.dirname(doc), bare)), posix.normalize(bare)]
  const found = candidates.find(path => tracked.has(path))
  if (found) return found
  if (!bare.includes('/')) return null
  const ending = `/${bare}`
  const matches = [...tracked].filter(path => path.endsWith(ending))
  return matches.length === 1 ? (matches[0] ?? null) : null
}

export function docReferences(doc: string, text: string, tracked: ReadonlySet<string>): string[] {
  const links = [...text.matchAll(LINK)]
    .map(match => (match[1] ?? '').split('#')[0]?.split('?')[0] ?? '')
    .filter(target => target && !/^[a-z][a-z+.-]*:/i.test(target))
  const code = [...text.matchAll(CODE)]
    .map(match => match[1] ?? '')
    .filter(target => target.includes('/') || /\.[a-z]+$/i.test(target))
  const found = [...links, ...code]
    .map(target => resolveReference(doc, target, tracked))
    .filter((path): path is string => path !== null)
  return [...new Set(found)].sort()
}

export function docsToReverify(
  docs: readonly { doc: string; references: readonly string[] }[],
  times: ReadonlyMap<string, number>
): StaleDoc[] {
  return docs
    .flatMap(({ doc, references }) => {
      const docTime = times.get(doc)
      if (docTime === undefined) return []
      const changed = references.filter(reference => (times.get(reference) ?? 0) > docTime)
      return changed.length ? [{ doc, changed }] : []
    })
    .sort((a, b) => b.changed.length - a.changed.length || a.doc.localeCompare(b.doc))
}

export function renderReport(stale: readonly StaleDoc[], date: string): string {
  const code = (path: string) => `\`${path}\``
  const line = ({ doc, changed }: StaleDoc) => {
    const more = changed.length > SHOWN ? `, and ${changed.length - SHOWN} more` : ''
    return `- ${code(doc)}: ${changed.slice(0, SHOWN).map(code).join(', ')}${more}`
  }
  return [
    '# Docs to re-verify',
    '',
    `Generated ${date} by \`pnpm --filter farty-web docs:report\`. Each doc names or links files that changed after the doc was last edited, the most changed first. Check that each still matches them.`,
    '',
    stale.length ? stale.map(line).join('\n') : 'None.',
    ''
  ].join('\n')
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })
}

function main(): void {
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel').trim()
  const tracked = new Set(git(root, 'ls-files', '-z').split('\0').filter(Boolean))
  const times = lastChangeTimes(git(root, 'log', '--format=%x00%ct', '--name-only', '--no-renames'))
  const docs = [...tracked].filter(isGardenedDoc).map(doc => ({
    doc,
    references: docReferences(doc, readFileSync(join(root, doc), 'utf8'), tracked)
  }))
  process.stdout.write(
    renderReport(docsToReverify(docs, times), new Date().toISOString().slice(0, 10))
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
