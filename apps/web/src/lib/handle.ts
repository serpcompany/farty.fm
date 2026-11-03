export const HANDLE_MIN = 3
export const HANDLE_MAX = 20

export type HandleProblem = 'chars' | 'short' | 'long' | 'blocked' | 'taken'

export function normalizeHandle(typed: string): string {
  return typed.trim().replace(/^@/, '').toLowerCase()
}

export function handleProblem(handle: string): Exclude<HandleProblem, 'taken'> | null {
  if (!/^[a-z0-9_]*$/.test(handle)) return 'chars'
  if (handle.length < HANDLE_MIN) return 'short'
  if (handle.length > HANDLE_MAX) return 'long'
  if (isBlocked(handle)) return 'blocked'
  return null
}

export function handleMessage(handle: string, problem: HandleProblem | null): string {
  switch (problem) {
    case 'chars':
      return 'Use only letters, numbers and _.'
    case 'short':
      return `Use at least ${HANDLE_MIN} characters.`
    case 'long':
      return `Use ${HANDLE_MAX} characters or fewer.`
    case 'blocked':
      return `@${handle} isn't allowed. Try another.`
    case 'taken':
      return `@${handle} is taken. Try another.`
    case null:
      return `@${handle} is free`
  }
}

export function suggestHandle(email: string): string {
  const name = (email.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, HANDLE_MAX)
  const padded = name.length >= HANDLE_MIN ? name : `${name}fart`.slice(0, HANDLE_MAX)
  return isBlocked(padded) ? '' : padded
}

const RESERVED = new Set([
  'about',
  'account',
  'admin',
  'administrator',
  'api',
  'app',
  'apps',
  'billing',
  'compose',
  'contact',
  'dev',
  'farty',
  'fartyfm',
  'farty_fm',
  'help',
  'home',
  'info',
  'login',
  'mod',
  'moderator',
  'moderators',
  'news',
  'null',
  'official',
  'pedos',
  'privacy',
  'profile',
  'record',
  'recordings',
  'root',
  'security',
  'settings',
  'signin',
  'signup',
  'staff',
  'support',
  'system',
  'team',
  'terms',
  'toots',
  'undefined',
  'www'
])

const HATEFUL_ANYWHERE = [
  'faggot',
  'hitler',
  'kike',
  'nazi',
  'nigg',
  'raghead',
  'retard',
  'tranny',
  'wetback'
]

const HATEFUL_WORDS = new Set(['chink', 'coon', 'dyke', 'fag', 'gook', 'paki', 'spic'])

const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't'
}

const unswapped = (text: string) => text.replace(/[013457]/g, digit => LOOKALIKES[digit] ?? digit)

const OWN_NAMES = ['farty', 'pedos']

const STAFF_WORDS = ['admin', 'official', 'support', 'staff', 'team']

const reservedForm = (handle: string) =>
  handle.replace(/[_.-]/g, '').replace(/[01345]/g, digit => LOOKALIKES[digit] ?? digit)

function passesForFarty(handle: string): boolean {
  const name = reservedForm(handle)
  return (
    RESERVED.has(handle) ||
    RESERVED.has(name) ||
    OWN_NAMES.some(word => name.includes(word)) ||
    STAFF_WORDS.includes(name) ||
    handle.split(/[_.-]/).some(word => STAFF_WORDS.includes(reservedForm(word)))
  )
}

function isBlocked(handle: string): boolean {
  if (passesForFarty(handle)) return true
  const plain = unswapped(handle.replace(/_/g, ''))
  if (HATEFUL_ANYWHERE.some(word => plain.includes(word))) return true
  const words = [plain, ...handle.split('_').map(unswapped)]
  return words.some(word => HATEFUL_WORDS.has(word) || HATEFUL_WORDS.has(word.replace(/s$/, '')))
}
