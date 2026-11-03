let grantedInThisPage = false
let grantRememberedByBrowser = false
let captureStoppedAt: number | null = null

const openWithoutTapMs = 50_000

async function permissionSaysGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state === 'granted'
  } catch {
    return false
  }
}

export async function mayOpenWithoutTap(): Promise<boolean> {
  if (!grantedInThisPage && !grantRememberedByBrowser) {
    const allowed = await permissionSaysGranted()
    if (allowed && !grantedInThisPage) grantRememberedByBrowser = true
  }
  if (grantRememberedByBrowser) return true
  return (
    grantedInThisPage &&
    (captureStoppedAt === null || Date.now() - captureStoppedAt <= openWithoutTapMs)
  )
}

export function microphoneGranted(): void {
  grantedInThisPage = true
}

export function captureStarted(): void {
  captureStoppedAt = null
}

export function captureStopped(): void {
  captureStoppedAt ??= Date.now()
}

export function captureStoppedJustNow(): void {
  captureStoppedAt = Date.now()
}
