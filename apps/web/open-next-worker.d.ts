declare module '*/.open-next/worker.js' {
  const openNextWorker: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>
  }
  export default openNextWorker
}
