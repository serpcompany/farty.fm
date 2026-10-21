// Web Storage for the unit tests, which run in Node: one that works, and one a browser blocked.

export function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

export function blockedStorage(): Storage {
  const blocked = () => {
    throw new DOMException('blocked', 'SecurityError')
  }
  return { ...memoryStorage(), getItem: blocked, setItem: blocked }
}
