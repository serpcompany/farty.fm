import { getCloudflareContext } from '@opennextjs/cloudflare'
import { ImageResponse } from 'next/og'
import { fartPhrase, sharedView } from './shared'

// The shared Recording's link image (ADR 0020), 1200×630, which Messages, WhatsApp and the like
// show: Farty's pink, the name, the note, who shared it, and its waveform. Drawn from D1 on each
// request, so a link that stops working takes its image with it.
export const dynamic = 'force-dynamic'
export const alt = 'A fart on Farty'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({
  params
}: {
  params: Promise<{ handle: string; id: string }>
}) {
  const { handle, id } = await params
  const view = await sharedView(handle, id)
  if (!view) return new Response('Not found', { status: 404, headers: noStore })
  const logo = await logoDataUrl()
  // The bundled font has no ♯ and would fetch one from Google Fonts, so a sharp is spelled "#".
  const note = view.note?.replace('♯', '#') ?? null
  const bars = view.levels.length > 0 ? view.levels : Array<number>(40).fill(0.05)
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: 60,
        color: 'white',
        backgroundImage: 'radial-gradient(120% 140% at 0% 0%, #fb1da9, #d1128a 55%, #9e0b67)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 52 }}>
          {logo && (
            // biome-ignore lint/performance/noImgElement: Satori draws a plain img.
            <img
              src={logo}
              alt=""
              width={96}
              height={96}
              style={{ borderRadius: 24, border: '5px solid rgba(255,255,255,0.35)' }}
            />
          )}
          Farty
        </div>
        {note && (
          <div
            style={{
              display: 'flex',
              background: 'white',
              color: '#b10f76',
              borderRadius: 999,
              padding: '10px 36px',
              fontSize: 58
            }}
          >
            {note}
          </div>
        )}
      </div>
      <div
        style={{ display: 'flex', marginTop: 56, fontSize: 116, letterSpacing: -4, lineHeight: 1 }}
      >
        {view.name}
      </div>
      <div style={{ display: 'flex', marginTop: 28, fontSize: 52, opacity: 0.92 }}>
        {`${fartPhrase(null)} by @${view.handle}`}
      </div>
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          gap: 7,
          marginTop: 40
        }}
      >
        {bars.map((level, bar) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: bars never move.
            key={bar}
            style={{
              flex: 1,
              height: `${Math.max(level, 0.06) * 100}%`,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.92)'
            }}
          />
        ))}
      </div>
    </div>,
    { ...size, headers: noStore }
  )
}

/** Not kept anywhere: a stopped link's image goes with it. */
const noStore = { 'Cache-Control': 'private, no-cache' }

/** Farty's icon from the Worker's own files, or null where there are none (`next dev`). */
async function logoDataUrl(): Promise<string | null> {
  try {
    const response = await getCloudflareContext().env.ASSETS?.fetch(
      'https://assets.local/icons/icon-192.png'
    )
    if (!response?.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return `data:image/png;base64,${btoa(binary)}`
  } catch {
    return null
  }
}
