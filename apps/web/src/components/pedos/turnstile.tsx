'use client'

import { useEffect, useEffectEvent, useRef } from 'react'

// Cloudflare Turnstile (#237): the check that a person, not a script, asks for a sign-in code. Its
// script loads from Cloudflare once, when the account step first shows its email.

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** The part of Turnstile's client API Farty uses (developers.cloudflare.com/turnstile). */
type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      size: 'flexible'
      'response-field': false
      callback(token: string): void
      'expired-callback'(): void
      'error-callback'(): void
      'timeout-callback'(): void
    }
  ): string | null | undefined
  remove(widgetId: string): void
}

const loaded = () => (window as { turnstile?: TurnstileApi }).turnstile

let loading: Promise<TurnstileApi> | null = null

/** Turnstile's API, loading its script the first time. A load that failed is tried again. */
function loadTurnstile(): Promise<TurnstileApi> {
  const api = loaded()
  if (api) return Promise.resolve(api)
  if (!loading) {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    const load = new Promise<TurnstileApi>((resolve, reject) => {
      script.onload = () => {
        const api = loaded()
        if (api) resolve(api)
        else reject(new Error('Turnstile loaded without its API'))
      }
      script.onerror = () => reject(new Error('Turnstile could not load'))
    })
    loading = load
    load.catch(() => {
      loading = null
      script.remove()
    })
    document.head.appendChild(script)
  }
  return loading
}

/**
 * The Turnstile widget, as wide as its container. `onToken` gets each token it gives, and null
 * when that one expires or the check fails; `onFailed` runs when its script can't load. A token
 * works once: a new widget (a new React `key`) gives the next.
 */
export function Turnstile({
  siteKey,
  onToken,
  onFailed
}: {
  siteKey: string
  onToken(token: string | null): void
  onFailed(): void
}) {
  const box = useRef<HTMLDivElement>(null)
  const token = useEffectEvent(onToken)
  const failed = useEffectEvent(onFailed)

  useEffect(() => {
    let current = true
    let widget: string | null | undefined
    loadTurnstile().then(
      api => {
        if (!current || !box.current) return
        widget = api.render(box.current, {
          sitekey: siteKey,
          size: 'flexible',
          'response-field': false,
          callback: value => token(value),
          'expired-callback': () => token(null),
          'error-callback': () => token(null),
          'timeout-callback': () => token(null)
        })
      },
      () => {
        if (current) failed()
      }
    )
    return () => {
      current = false
      if (widget) loaded()?.remove(widget)
    }
  }, [siteKey])

  // Turnstile's widget is 65px tall: the space is kept while it loads.
  return <div ref={box} className="min-h-[65px]" data-testid="turnstile" />
}
