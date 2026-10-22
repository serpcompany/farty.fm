import type { ViewportSize } from '@playwright/test'

/**
 * A phone: narrower than 768px, with Welcome and the tab bar at the bottom. The tablet project is
 * wider, with the top bar and the lander at `/`; the desktop project runs only `desktop.spec.ts`.
 */
export function onPhone({ viewport }: { viewport: ViewportSize | null }): boolean {
  return (viewport?.width ?? 0) < 768
}
