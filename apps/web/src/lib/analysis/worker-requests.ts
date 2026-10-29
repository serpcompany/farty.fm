type Numbered = { id: number }

interface Settle<Result> {
  resolve(result: Result): void
  reject(error: Error): void
}

interface Reply<Result> extends Numbered {
  result?: Result
  error?: string
}

interface RequestScope<Request> {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage(message: Reply<unknown>, transfer?: Transferable[]): void
}

export function workerRequests<Request extends Numbered, Result>(
  start: () => Worker,
  failure: string
): (request: Omit<Request, 'id'>) => Promise<Result> {
  let worker: Worker | null = null
  let nextId = 0
  const pending = new Map<number, Settle<Result>>()

  function running(): Worker {
    if (worker) return worker
    worker = start()
    worker.onmessage = (event: MessageEvent<Reply<Result>>) => {
      const { id, result, error } = event.data
      const request = pending.get(id)
      pending.delete(id)
      if (!request) return
      if (result) request.resolve(result)
      else request.reject(new Error(error ?? failure))
    }
    worker.onerror = event => {
      for (const request of pending.values()) request.reject(new Error(event.message))
      pending.clear()
      worker?.terminate()
      worker = null
    }
    return worker
  }

  return request =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      running().postMessage({ id, ...request })
    })
}

export function answerRequests<Request extends Numbered, Result>(
  answer: (request: Request) => Result,
  transferred: (result: Result) => Transferable[] = () => []
): void {
  const scope = self as unknown as RequestScope<Request>
  scope.onmessage = event => {
    const { id } = event.data
    try {
      const result = answer(event.data)
      scope.postMessage({ id, result }, transferred(result))
    } catch (error) {
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
