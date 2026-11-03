import { encode } from 'uqr'
import { productionOrigin, type SiteEnv, siteEnv, siteOrigin } from './site'

export function downloadUrl(env: SiteEnv = siteEnv()): string {
  return siteOrigin(env) ?? productionOrigin
}

export const quietZone = 4

export function qrCode(text: string): { size: number; path: string } {
  const { data } = encode(text, { ecc: 'M', border: quietZone })
  let path = ''
  data.forEach((row, y) => {
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
