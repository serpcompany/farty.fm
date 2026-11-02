// A Handle (ADR 0020): the name in a user's links, `farty.fm/u/<handle>/…`. 3 to 20 lowercase
// letters, digits or _, picked the first time they share, unique, and never one on the block list.
// The account step's handle field and the server (`src/server/sharing.ts`) check it the same way.

export const HANDLE_MIN = 3
export const HANDLE_MAX = 20

/** Why a Handle can't be used. `taken` comes from the server. */
export type HandleProblem = 'chars' | 'short' | 'long' | 'blocked' | 'taken'

/** What a person typed, as a Handle: no `@`, no spaces around it, and lowercase. */
export function normalizeHandle(typed: string): string {
  return typed.trim().replace(/^@/, '').toLowerCase()
}

/** Why `handle` (already normalized) can't be used, or null when it can, unless it's taken. */
export function handleProblem(handle: string): Exclude<HandleProblem, 'taken'> | null {
  if (!/^[a-z0-9_]*$/.test(handle)) return 'chars'
  if (handle.length < HANDLE_MIN) return 'short'
  if (handle.length > HANDLE_MAX) return 'long'
  if (isBlocked(handle)) return 'blocked'
  return null
}

/** What the handle field says about `problem`. */
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

/**
 * A first Handle to offer: the email's name, as a Handle, padded or cut to fit. The person can
 * change it before they share, and the server says if it's taken.
 */
export function suggestHandle(email: string): string {
  const name = (email.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, HANDLE_MAX)
  const padded = name.length >= HANDLE_MIN ? name : `${name}fart`.slice(0, HANDLE_MAX)
  return isBlocked(padded) ? '' : padded
}

/**
 * Names that would pass for Farty itself or one of its pages. A Handle is never one of these.
 */
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

/**
 * Slurs and hate words a Handle can't contain anywhere, matched after undoing digit-for-letter
 * swaps and dropping `_`, so `n4z1` and `na_zi` are caught too. Fart words are welcome.
 */
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

/** Slurs that are also parts of harmless words (`spicy`, `raccoon`): blocked only as a word. */
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

/** Farty's own names: no Handle holds one anywhere, so `farty_official` and `f4rty1` are refused. */
const OWN_NAMES = ['farty', 'pedos']

/** Words that make a name pass for staff: no Handle starts or ends with one (`pedos_admin`). */
const STAFF_WORDS = ['admin', 'official', 'support', 'staff', 'team']

/** A Handle as its reserved names are checked: no `_`, `.` or `-`, and digit swaps undone. */
const reservedForm = (handle: string) =>
  handle.replace(/[_.-]/g, '').replace(/[01345]/g, digit => LOOKALIKES[digit] ?? digit)

function passesForFarty(handle: string): boolean {
  const name = reservedForm(handle)
  return (
    RESERVED.has(handle) ||
    RESERVED.has(name) ||
    OWN_NAMES.some(word => name.includes(word)) ||
    STAFF_WORDS.some(word => name.startsWith(word) || name.endsWith(word))
  )
}

function isBlocked(handle: string): boolean {
  if (passesForFarty(handle)) return true
  const plain = unswapped(handle.replace(/_/g, ''))
  if (HATEFUL_ANYWHERE.some(word => plain.includes(word))) return true
  const words = [plain, ...handle.split('_').map(unswapped)]
  return words.some(word => HATEFUL_WORDS.has(word) || HATEFUL_WORDS.has(word.replace(/s$/, '')))
}
