import openNext from './.open-next/worker.js'
import { otherHostResponse } from './src/lib/other-hosts'
import { type EntryEnv, servedByTheEntry } from './src/lib/staging-access'

// The Worker entry: `www` and the workers.dev hosts redirect to the environment's own host
// (src/lib/other-hosts.ts), then the Staging gate runs (src/lib/staging-access.ts).
export default {
  async fetch(request: Request, env: EntryEnv, ctx: unknown): Promise<Response> {
    const redirect = otherHostResponse(request, env.SITE_ENV)
    if (redirect) return redirect
    return servedByTheEntry(request, env, forwarded => openNext.fetch(forwarded, env, ctx))
  }
}
