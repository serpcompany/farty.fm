'use client'

import { Ellipsis, EllipsisVertical, Menu, Share } from 'lucide-react'
import { type ReactNode, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import {
  currentInstallGuide,
  currentInstallRoute,
  type InstallGuide,
  type InstallRoute,
  promptInstall,
  subscribeToInstall
} from '@/lib/install'

export function useInstallRoute(): InstallRoute | null {
  return useSyncExternalStore(subscribeToInstall, currentInstallRoute, () => null)
}

export function useInstallGuide(): InstallGuide | null {
  return useSyncExternalStore(subscribeToInstall, currentInstallGuide, () => null)
}

const icon = 'inline size-4 -translate-y-px align-text-bottom'

function Control({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>
}

function Steps({ guide }: { guide: InstallGuide }) {
  switch (guide) {
    case 'share-sheet':
      return (
        <>
          <li>
            Tap <Control>Share</Control>
            <Share className={`${icon} ml-1`} aria-hidden />. If you don't see it, tap{' '}
            <Ellipsis className={icon} aria-hidden />
            <span className="sr-only">More</span> first.
          </li>
          <li>
            Tap <Control>Add to Home Screen</Control>. Scroll down or tap{' '}
            <Control>View More</Control> to find it.
          </li>
          <li>
            Tap <Control>Add</Control>.
          </li>
        </>
      )
    case 'browser-menu':
      return (
        <>
          <li>
            Tap the <Control>menu</Control> <EllipsisVertical className={icon} aria-hidden /> in
            your browser.
          </li>
          <li>
            Tap <Control>Install app</Control> or <Control>Add to Home screen</Control>. Scroll down
            if you don't see it.
          </li>
          <li>
            Tap <Control>Install</Control>.
          </li>
        </>
      )
    case 'samsung-menu':
      return (
        <>
          <li>
            Tap the <Control>menu</Control> <Menu className={icon} aria-hidden /> in your browser.
          </li>
          <li>
            Tap <Control>Add page to</Control>, then <Control>Home screen</Control>.
          </li>
          <li>
            Tap <Control>Add</Control> or <Control>Install</Control>.
          </li>
        </>
      )
    case 'open-in-safari':
      return (
        <>
          <li>
            In this app's menu, tap <Control>Open in Safari</Control> or{' '}
            <Control>Open in browser</Control>.
          </li>
          <li>In Safari, follow the steps that show here.</li>
        </>
      )
    case 'open-in-browser':
      return (
        <>
          <li>
            In this app's menu, tap <Control>Open in Chrome</Control> or{' '}
            <Control>Open in browser</Control>.
          </li>
          <li>In your browser, follow the steps that show here.</li>
        </>
      )
    default:
      return null
  }
}

export function InstallGuideCard() {
  const guide = useInstallGuide()
  if (guide === null) return null
  return (
    <div className="rounded-xl bg-muted/60 px-4 py-3" data-testid="install-guide">
      {guide === 'installed' ? (
        <>
          <p className="font-medium">Farty is installed</p>
          <p className="text-sm text-muted-foreground">
            It's on your Home Screen and opens full screen, like an app.
          </p>
        </>
      ) : guide === 'phone' ? (
        <p>Farty is a phone app. Open this page on your phone to add it to your Home Screen.</p>
      ) : (
        <>
          <p>Add Farty to your Home Screen. It gets an icon and opens full screen, like an app.</p>
          {guide === 'prompt' ? (
            <Button className="mt-3 h-11 px-5 text-base" onClick={() => void promptInstall()}>
              Install app
            </Button>
          ) : (
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 marker:text-muted-foreground">
              <Steps guide={guide} />
            </ol>
          )}
        </>
      )}
    </div>
  )
}

export function ShareSheetHint() {
  return (
    <p className="text-sm text-muted-foreground">
      Tap <Share className="inline size-4 -translate-y-px align-text-bottom" aria-hidden /> Share,
      then Add to Home Screen
    </p>
  )
}
