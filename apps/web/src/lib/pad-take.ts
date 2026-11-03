import { legacyOwner, libraryOwner } from './account'
import { isPerformance, type Performance } from './performance'

const KEY = 'pedos.padTakes'

export const MAX_KEPT_TAKES = 5

export type KeptTake = {
  tootId: string
  performance: Performance
  account: string | null
  checkout: boolean
}

function isKeptTake(value: unknown): value is KeptTake {
  if (typeof value !== 'object' || value === null) return false
  const { tootId, performance, account, checkout } = value as Record<string, unknown>
  return (
    typeof tootId === 'string' &&
    isPerformance(performance) &&
    (account === null || typeof account === 'string') &&
    typeof checkout === 'boolean'
  )
}

function stored(): KeptTake[] {
  const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
  return Array.isArray(value) ? value.filter(isKeptTake) : []
}

function store(takes: KeptTake[]): void {
  if (takes.length === 0) localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, JSON.stringify(takes))
}

function capped(takes: KeptTake[]): KeptTake[] {
  const newest = (checkout: boolean) =>
    new Set(takes.filter(take => take.checkout === checkout).slice(-MAX_KEPT_TAKES))
  const keeps = new Set([...newest(false), ...newest(true)])
  return takes.filter(take => keeps.has(take))
}

const owner = (): string | null => libraryOwner()

function put(take: KeptTake): boolean {
  try {
    const takes = stored().filter(kept => kept.tootId !== take.tootId)
    takes.push(take)
    store(capped(takes))
    return true
  } catch {
    return false
  }
}

export function keepTake(tootId: string, performance: Performance): boolean {
  try {
    return put({ tootId, performance, account: owner(), checkout: false })
  } catch {
    return false
  }
}

export function keepForCheckout(
  tootId: string,
  performance: Performance,
  accountId: string
): boolean {
  try {
    const whose = owner()
    if (whose !== null && whose !== legacyOwner && whose !== accountId) return false
  } catch {
    return false
  }
  return put({ tootId, performance, account: accountId, checkout: true })
}

export function keptTakes(): KeptTake[] {
  try {
    const whose = owner()
    return stored()
      .filter(take => take.account === whose)
      .reverse()
  } catch {
    return []
  }
}

export function keptTake(tootId: string): KeptTake | null {
  return keptTakes().find(take => take.tootId === tootId) ?? null
}

function forget(drops: (take: KeptTake) => boolean): void {
  try {
    const takes = stored()
    const left = takes.filter(take => !drops(take))
    if (left.length !== takes.length) store(left)
  } catch {}
}

export function forgetTake(tootId: string): void {
  forget(take => take.tootId === tootId)
}

export function releaseTakes(account: string | null): void {
  forget(take => take.account === account && !take.checkout)
}

export function adoptTakes(from: string | null, accountId: string): void {
  try {
    const takes = stored()
    if (!takes.some(take => take.account === from)) return
    store(takes.map(take => (take.account === from ? { ...take, account: accountId } : take)))
  } catch {}
}
