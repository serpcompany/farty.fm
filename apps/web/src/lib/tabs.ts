export const tabs = [
  { id: 'recordings', href: '/recordings/', label: 'Recordings' },
  { id: 'compose', href: '/compose/', label: 'Compose' },
  { id: 'record', href: '/', label: 'Record' },
  { id: 'toots', href: '/toots/', label: 'Toots' },
  { id: 'profile', href: '/profile/', label: 'Profile' }
] as const

export type Tab = (typeof tabs)[number]['id']

export function tabOf(pathname: string): Tab | null {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`
  if (path === '/') return 'record'
  return tabs.find(tab => tab.href !== '/' && path.startsWith(tab.href))?.id ?? null
}
