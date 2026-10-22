import { encode } from 'uqr'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { downloadUrl, qrCode, quietZone } from './download-qr'

describe("Download App's QR code", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test.each([
    ['production', 'https://farty.fm'],
    ['staging', 'https://staging.farty.fm'],
    // A local run has no host of its own, and a phone can't reach the computer's localhost.
    ['', 'https://farty.fm']
  ])("opens the build's own origin (SITE_ENV=%s)", (siteEnv, url) => {
    vi.stubEnv('SITE_ENV', siteEnv)
    expect(downloadUrl()).toBe(url)
  })

  test('draws exactly the encoded dark modules, inside an empty quiet zone', () => {
    const text = 'https://staging.farty.fm'
    const { data } = encode(text, { ecc: 'M', border: quietZone })
    const { size, path } = qrCode(text)
    expect(size).toBe(data.length)

    const drawn = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
    for (const [, x, y, width] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(width); i += 1) drawn[Number(y)][Number(x) + i] = true
    }
    expect(drawn).toEqual(data)

    const edge = (i: number) => i < quietZone || i >= size - quietZone
    expect(data.every((row, y) => row.every((dark, x) => !dark || !(edge(x) || edge(y))))).toBe(
      true
    )
    // Nothing else is in the path.
    expect(path.replace(/M\d+ \d+h\d+v1h-\d+z/g, '')).toBe('')
  })
})
