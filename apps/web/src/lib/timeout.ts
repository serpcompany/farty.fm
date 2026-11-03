export async function withinTimeout<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  try {
    return await work(timeout.signal)
  } finally {
    clearTimeout(timer)
  }
}
