import { encode } from 'uqr'
import { productionOrigin, type SiteEnv, siteEnv, siteOrigin } from './site'

/**
 * What Download App's QR code opens (#199): the environment's own origin. A local run has none, so
 * its code opens Production's.
 */
export function downloadUrl(env: SiteEnv = siteEnv()): string {
  return siteOrigin(env) ?? productionOrigin
}

/** The empty margin a scanner needs around a QR code, in modules. */
export const quietZone = 4

/**
 * `text` as a QR code: its dark modules as one SVG path, in a square `size` modules wide with the
 * quiet zone. Medium error correction, so a scan off a screen survives some glare.
 */
export function qrCode(text: string): { size: number; path: string } {
  const { data } = encode(text, { ecc: 'M', border: quietZone })
  let path = ''
  data.forEach((row, y) => {
    // One rectangle per run of dark modules in a row.
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x += 1
        continue
      }
      const start = x
      while (row[x]) x += 1
      path += `M${start} ${y}h${x - start}v1h${start - x}z`
    }
  })
  return { size: data.length, path }
}
