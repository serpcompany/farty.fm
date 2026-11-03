import { afterEach, describe, expect, it, vi } from 'vitest'
import { button, closeScreens, show, tap } from '@/test-support/screen'
import { Lander } from './lander'

const finishWelcome = vi.fn()
const openStep = vi.fn()

vi.mock('./welcome-provider', () => ({ useWelcome: () => ({ finishWelcome }) }))
vi.mock('./account-provider', () => ({ useAccount: () => ({ openStep }) }))

async function showLanderOn(environment: string) {
  vi.stubEnv('FARTY_ENVIRONMENT', environment)
  vi.resetModules()
  const built = await import('./lander')
  await show(<built.Lander atHome qrCode={null} />)
}

function answerTo(question: string): string | null | undefined {
  const asked = [...document.body.querySelectorAll('dt')].find(dt => dt.textContent === question)
  return asked?.nextElementSibling?.textContent
}

afterEach(() => {
  closeScreens()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('the lander', () => {
  it.each([
    'Sign in',
    'Sign up free'
  ])('opens the app with the account step on it (%s)', async name => {
    await show(<Lander atHome qrCode={null} />)
    await tap(button(name))

    expect(finishWelcome).toHaveBeenCalledOnce()
    expect(openStep).toHaveBeenCalledOnce()
  })

  it.each([
    'staging',
    'local',
    'production'
  ])('says saving a Toot costs $0.99, on every environment (%s)', async environment => {
    await showLanderOn(environment)
    expect(answerTo('Is Farty free?')).toBe(
      'Recording and making Toots is free, and so is an account. Saving a Toot costs $0.99.'
    )
  })
})
