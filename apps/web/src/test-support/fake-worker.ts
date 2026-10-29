type Handler = ((event: MessageEvent) => void) | null

export class WorkerScope {
  onmessage: Handler = null
  readonly posted: { message: unknown; transfer: Transferable[] }[] = []
  page: { onmessage: Handler } | null = null

  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.posted.push({ message, transfer })
    const data = structuredClone(message, { transfer })
    setTimeout(() => this.page?.onmessage?.(new MessageEvent('message', { data })))
  }
}

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
      const errorWithOnlyTheMessageTheClientReads = { message } as ErrorEvent
      this.onerror?.(errorWithOnlyTheMessageTheClientReads)
    }

    terminate() {
      this.terminated = true
    }
  }
}
