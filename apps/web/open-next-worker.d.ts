// The OpenNext Worker that `opennextjs-cloudflare build` writes, which worker.ts falls through to.
declare module '*/.open-next/worker.js' {
  const openNextWorker: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>
  }
  export default openNextWorker
}
