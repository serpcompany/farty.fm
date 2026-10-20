/**
 * The five tabs, as the iPhone app's `AppTabs`, left to right: Record sits in the center for
 * thumb reach, and the app opens on it. Each tab is a route.
 */
export const tabs = [
  { id: 'recordings', href: '/recordings/', label: 'Recordings' },
  { id: 'compose', href: '/compose/', label: 'Compose' },
  { id: 'record', href: '/', label: 'Record' },
  { id: 'toots', href: '/toots/', label: 'Toots' },
  { id: 'profile', href: '/profile/', label: 'Profile' }
] as const

export type Tab = (typeof tabs)[number]['id']

/**
 * The tab a page is on. A screen pushed inside a tab stays on it, as on the iPhone:
 * `/compose/<song>/` is on Compose. A page outside the tabs is on none.
 */
export function tabOf(pathname: string): Tab | null {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`
  if (path === '/') return 'record'
  return tabs.find(tab => tab.href !== '/' && path.startsWith(tab.href))?.id ?? null
}
