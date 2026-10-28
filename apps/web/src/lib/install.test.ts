import { describe, expect, it } from 'vitest'
import { installGuideFor, installRouteFor } from './install'

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
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 15; SAMSUNG SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidTabletDesktopSite:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A.241105.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.43 Mobile Safari/537.36',
  androidInstagram:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A.241105.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.43 Mobile Safari/537.36 Instagram 400.0.0.0.0 Android',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A.241105.008) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.43 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/520.0.0.38.101;]',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chromeOS:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0'
}

type Browser = Parameters<typeof installRouteFor>[0]

const touchScreen = { maxTouchPoints: 5, standalone: false, canPrompt: false }

function browser(userAgent: string, overrides: Partial<Browser> = {}) {
  return installRouteFor({ userAgent, ...touchScreen, ...overrides })
}

function guide(userAgent: string, overrides: Partial<Browser> = {}) {
  return installGuideFor({ userAgent, ...touchScreen, ...overrides })
}

describe('installRouteFor', () => {
  it('uses the Share sheet on iPhone and iPad, in Safari and the browsers built on it', () => {
    expect(browser(userAgents.iPhoneSafari)).toBe('share-sheet')
    expect(browser(userAgents.iPhoneChrome)).toBe('share-sheet')
    expect(browser(userAgents.iPadSafari)).toBe('share-sheet')
  })

  it("offers nothing where Farty can't be added to the Home Screen", () => {
    expect(browser(userAgents.iPhoneInstagram)).toBeNull()
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
    expect(browser(userAgents.iPadSafari, { maxTouchPoints: 0 })).toBeNull()
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

describe('installGuideFor', () => {
  it('uses the Share sheet on iPhone and iPad, in Safari and the browsers built on it', () => {
    expect(guide(userAgents.iPhoneSafari)).toBe('share-sheet')
    expect(guide(userAgents.iPhoneChrome)).toBe('share-sheet')
    expect(guide(userAgents.iPadSafari)).toBe('share-sheet')
  })

  it("sends an iPhone's in-app browsers to Safari first", () => {
    for (const app of [
      'iPhoneInstagram',
      'iPhoneGoogleApp',
      'iPhoneFacebook',
      'iPhoneLine',
      'iPhoneTwitter',
      'iPhoneLinkedIn',
      'iPhoneSnapchat'
    ] as const) {
      expect(guide(userAgents[app]), app).toBe('open-in-safari')
    }
  })

  it("uses the browser's menu on Android until Chrome offers its prompt", () => {
    for (const android of [
      'androidChrome',
      'androidFirefox',
      'androidTabletDesktopSite'
    ] as const) {
      expect(guide(userAgents[android]), android).toBe('browser-menu')
    }
    expect(guide(userAgents.androidSamsung)).toBe('samsung-menu')
    expect(guide(userAgents.androidChrome, { canPrompt: true })).toBe('prompt')
    expect(guide(userAgents.androidTabletDesktopSite, { canPrompt: true })).toBe('prompt')
  })

  it("sends Android's in-app browsers to the browser first", () => {
    expect(guide(userAgents.androidWebView)).toBe('open-in-browser')
    expect(guide(userAgents.androidInstagram)).toBe('open-in-browser')
    expect(guide(userAgents.androidFacebook)).toBe('open-in-browser')
  })

  it('says to open Farty on a phone from a computer', () => {
    const mouse = { maxTouchPoints: 0 }
    expect(guide(userAgents.macSafari, mouse)).toBe('phone')
    expect(guide(userAgents.iPadSafari, mouse)).toBe('phone')
    expect(guide(userAgents.windowsChrome, mouse)).toBe('phone')
    expect(guide(userAgents.linuxFirefox, mouse)).toBe('phone')
    expect(guide(userAgents.androidTabletDesktopSite, mouse)).toBe('phone')
    expect(guide(userAgents.chromeOS)).toBe('phone')
    expect(guide(userAgents.windowsChrome)).toBe('phone')
  })

  it('says Farty is installed once it runs from the Home Screen', () => {
    expect(guide(userAgents.iPhoneSafari, { standalone: true })).toBe('installed')
    expect(guide(userAgents.androidChrome, { canPrompt: true, standalone: true })).toBe('installed')
    expect(guide(userAgents.windowsChrome, { standalone: true })).toBe('installed')
  })
})
