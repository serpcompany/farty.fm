// The Worker entry (wrangler.jsonc `main`): the Staging gate, then OpenNext. The gate and its
// tests are in src/lib/staging-access.ts.
import openNext from './.open-next/worker.js'
import { type EntryEnv, servedByTheEntry } from './src/lib/staging-access'

export default {
  fetch(request: Request, env: EntryEnv, ctx: unknown): Promise<Response> {
    return servedByTheEntry(request, env, forwarded => openNext.fetch(forwarded, env, ctx))
  }
}
