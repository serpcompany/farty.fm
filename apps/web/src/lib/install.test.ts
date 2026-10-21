import { describe, expect, it } from 'vitest'
import { installRouteFor } from './install'

const userAgents = {
  iPhoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iPhoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  iPhoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0 (iPhone16,2; iOS 18_6; en_US)',
  iPhoneGoogleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/385.0.786574578 Mobile/15E148 Safari/604.1',
  iPhoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/520.0.0.38.101;FBBV/123;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]',
  iPhoneLine:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.16.0',
  iPhoneTwitter:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.70 Safari/604.1',
  iPhoneLinkedIn:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 [LinkedInApp]/9.31.1',
  iPhoneSnapchat:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.60.0.42 (like Safari/8621.1.15.10.7, panda)',
  iPadSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
}

type Browser = Parameters<typeof installRouteFor>[0]

/** A touch-screen browser that isn't installed and hasn't offered Chrome's prompt. */
function browser(userAgent: string, overrides: Partial<Browser> = {}) {
  const defaults = { maxTouchPoints: 5, standalone: false, canPrompt: false }
  return installRouteFor({ userAgent, ...defaults, ...overrides })
}

describe('installRouteFor', () => {
  it('uses the Share sheet on iPhone and iPad, in Safari and the browsers built on it', () => {
    expect(browser(userAgents.iPhoneSafari)).toBe('share-sheet')
    expect(browser(userAgents.iPhoneChrome)).toBe('share-sheet')
    expect(browser(userAgents.iPadSafari)).toBe('share-sheet')
  })

  it("offers nothing where Farty can't be added to the Home Screen", () => {
    expect(browser(userAgents.iPhoneInstagram)).toBeNull()
    // In-app browsers that name their app, even beside "Safari/".
    for (const app of [
      'iPhoneGoogleApp',
      'iPhoneFacebook',
      'iPhoneLine',
      'iPhoneTwitter',
      'iPhoneLinkedIn',
      'iPhoneSnapchat'
    ] as const) {
      expect(browser(userAgents[app]), app).toBeNull()
    }
    // A Mac: the same user agent as an iPad, but no touch screen.
    expect(browser(userAgents.iPadSafari, { maxTouchPoints: 0 })).toBeNull()
    // Android before Chrome offers its prompt, or after Farty is installed.
    expect(browser(userAgents.androidChrome)).toBeNull()
  })

  it("uses Chrome's prompt once Chrome offers it", () => {
    expect(browser(userAgents.androidChrome, { canPrompt: true })).toBe('prompt')
  })

  it('offers nothing once Farty runs from the Home Screen', () => {
    expect(browser(userAgents.iPhoneSafari, { standalone: true })).toBeNull()
    expect(browser(userAgents.androidChrome, { canPrompt: true, standalone: true })).toBeNull()
  })
})
