// A Web Worker on the test's own thread, for the render worker's tests. Test support only (Node):
// nothing here ships.
//
// `WorkerScope` stands in for the worker's `self`: install it as the global `self`, then import
// the worker module, which sets `self.onmessage`. `bridgedWorker(scope)` is a `Worker` class
// whose messages reach that module. Messages go through `structuredClone`, and a transferred
// buffer is detached on the sending side, as between threads.

type Handler = ((event: MessageEvent) => void) | null

/** The worker's global scope: what the worker module sees as `self`. */
export class WorkerScope {
  onmessage: Handler = null
  /** Every message the worker posted, with what it transferred, in order. */
  readonly posted: { message: unknown; transfer: Transferable[] }[] = []
  /** The page's side of the worker, which receives what the worker posts. */
  page: { onmessage: Handler } | null = null

  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.posted.push({ message, transfer })
    const data = structuredClone(message, { transfer })
    setTimeout(() => this.page?.onmessage?.(new MessageEvent('message', { data })))
  }
}

/** A `Worker` class, as `new Worker(url, options)` makes one, that runs on `scope`. */
export function bridgedWorker(scope: WorkerScope) {
  return class BridgedWorker {
    static readonly created: BridgedWorker[] = []
    onmessage: Handler = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminated = false

    constructor(
      readonly url: URL,
      readonly options?: WorkerOptions
    ) {
      scope.page = this
      BridgedWorker.created.push(this)
    }

    postMessage(message: unknown, transfer: Transferable[] = []) {
      const data = structuredClone(message, { transfer })
      setTimeout(() => scope.onmessage?.(new MessageEvent('message', { data })))
    }

    terminate() {
      this.terminated = true
      if (scope.page === this) scope.page = null
    }
  }
}

/** A `Worker` class that never answers by itself: the test replies, or fails it, by hand. */
export function manualWorker() {
  return class ManualWorker {
    static readonly created: ManualWorker[] = []
    onmessage: Handler = null
    onerror: ((event: ErrorEvent) => void) | null = null
    readonly received: unknown[] = []
    terminated = false

    constructor(
      readonly url: URL,
      readonly options?: WorkerOptions
    ) {
      ManualWorker.created.push(this)
    }

    postMessage(message: unknown) {
      this.received.push(message)
    }

    reply(data: unknown) {
      this.onmessage?.(new MessageEvent('message', { data }))
    }

    fail(message: string) {
      // Only the message: the client reads nothing else of a worker's error.
      this.onerror?.({ message } as ErrorEvent)
    }

    terminate() {
      this.terminated = true
    }
  }
}
