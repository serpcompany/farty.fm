import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportError } from '@/lib/telemetry/errors'
import ErrorPage from './error'
import GlobalError from './global-error'

vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const container = document.body.appendChild(document.createElement('main'))
const root = createRoot(container)

afterEach(() => {
  act(() => root.render(null))
  vi.unstubAllGlobals()
})

describe('the error pages', () => {
  it('report what broke the screen, by a stable code', async () => {
    const error = new TypeError('Cannot read properties of undefined')
    await act(async () => root.render(<ErrorPage error={error} />))

    expect(reportError).toHaveBeenCalledExactlyOnceWith('uncaught-error', error)
    expect(container.textContent).toContain('Something went wrong')
  })

  it('reload Farty when Reload is tapped', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    await act(async () => root.render(<ErrorPage error={new Error('render failed')} />))

    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Reload')
    act(() => button?.click())
    expect(reload).toHaveBeenCalledOnce()
  })

  it('give a broken root layout a whole page of its own', () => {
    const page = renderToStaticMarkup(<GlobalError error={new Error('layout failed')} />)

    expect(page).toMatch(/^<html lang="en"/)
    expect(page).toContain('Something went wrong')
    expect(page).toContain('Reload')
  })
})
