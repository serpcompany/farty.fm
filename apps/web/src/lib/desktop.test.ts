import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { desktop } from './desktop'

test("globals.css's desktop variant is the same query the scripts match", () => {
  const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8')
  expect(css).toContain(`@custom-variant desktop (@media ${desktop});`)
})
