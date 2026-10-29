export const tabs = [
  { id: 'recordings', href: '/recordings/', label: 'Recordings' },
  { id: 'compose', href: '/compose/', label: 'Compose' },
  { id: 'record', href: '/', label: 'Record' },
  { id: 'toots', href: '/toots/', label: 'Toots' },
  { id: 'profile', href: '/profile/', label: 'Profile' }
] as const

export type Tab = (typeof tabs)[number]['id']

export function tabOf(segments: readonly string[]): Tab | null {
  const [first] = segments
  if (first === undefined) return 'record'
  return tabs.find(tab => tab.href === `/${first}/`)?.id ?? null
}
