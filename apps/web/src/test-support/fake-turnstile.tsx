import { act, useEffect, useState } from 'react'

type Widget = { siteKey: string; onToken(token: string | null): void; onFailed(): void }

export const widgets: Widget[] = []

export function Turnstile(props: Widget) {
  const [widget] = useState(props)
  useEffect(() => {
    widgets.push(widget)
  }, [widget])
  return null
}

export const giveToken = (widget: number, token: string) =>
  act(async () => widgets[widget].onToken(token))

export const siteKeyAnswer = () => Response.json({ siteKey: '1x00000000000000000000AA' })
