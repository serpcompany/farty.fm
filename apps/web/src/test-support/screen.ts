import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const closes: (() => void)[] = []

export async function show(screen: ReactNode): Promise<(next: ReactNode) => Promise<void>> {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  closes.push(() => {
    root.unmount()
    container.remove()
  })
  const render = (next: ReactNode) => act(async () => root.render(next))
  await render(screen)
  return render
}

export function closeScreens(): void {
  act(() => {
    for (const close of closes.splice(0)) close()
  })
}

export const pageText = () => document.body.textContent ?? ''

function nameOf(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim()
}

function buttons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll('button')]
}

export function button(name: string): HTMLButtonElement {
  const found = buttons().find(candidate => nameOf(candidate) === name)
  if (!found) throw new Error(`No button named ${name}: ${buttons().map(nameOf).join(' | ')}`)
  return found
}

export const tap = (element: HTMLElement) => act(async () => element.click())

export async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

export async function hideAndShowPage(): Promise<void> {
  await act(async () => setVisibility('hidden'))
  await act(async () => setVisibility('visible'))
}

export function dialogs(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
}
