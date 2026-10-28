import { afterEach, describe, expect, it, vi } from 'vitest'
import { button, closeScreens, show, tap } from '@/test-support/screen'

const finishWelcome = vi.fn()
const openStep = vi.fn()

vi.mock('./welcome-provider', () => ({ useWelcome: () => ({ finishWelcome }) }))
vi.mock('./account-provider', () => ({ useAccount: () => ({ openStep }) }))

async function showLander(environment?: string) {
  if (environment) vi.stubEnv('FARTY_ENVIRONMENT', environment)
  vi.resetModules()
  const { Lander } = await import('./lander')
  await show(<Lander atHome qrCode={null} />)
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
    await showLander()
    await tap(button(name))

    expect(finishWelcome).toHaveBeenCalledOnce()
    expect(openStep).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'staging',
      'Recording and making Toots is free, and so is an account. Saving a Toot costs $0.99.'
    ],
    [
      'local',
      'Recording and making Toots is free, and so is an account. Saving a Toot costs $0.99.'
    ],
    ['production', 'Yes. Farty is free, and so is an account.']
  ])('answers whether Farty is free as its environment does (%s)', async (environment, answer) => {
    await showLander(environment)
    expect(answerTo('Is Farty free?')).toBe(answer)
  })
})
