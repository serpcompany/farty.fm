import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { devNull } from 'node:os'
import { dirname, join } from 'node:path'

const wranglerPackage = createRequire(import.meta.url).resolve('wrangler/package.json')
const wrangler = join(dirname(wranglerPackage), 'bin/wrangler.js')
const withoutLocalSecrets = ['--env-file', devNull]
const typegen = [
  'types',
  ...withoutLocalSecrets,
  '--env-interface',
  'CloudflareEnv',
  './cloudflare-env.d.ts'
]

const { status } = spawnSync(process.execPath, [wrangler, ...typegen, ...process.argv.slice(2)], {
  stdio: 'inherit'
})
process.exit(status ?? 1)
