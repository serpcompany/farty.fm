import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { ImageResponse } from 'next/og'
import { siteOrigin } from '@/lib/site'

// A shared link's preview (ADR 0020), for a Recording's page and a Toot's alike: the page's
// metadata, with its Open Graph tags, and its 1200×630 image in Farty's pink, which Messages,
// WhatsApp and the like show. Both are drawn from D1 on each request, so a link that stops working
// takes its preview with it.

/**
 * The origin this page is served on: the environment's own, or on a local run, which has no host
 * of its own, the request's. Null when there's no telling.
 */
export async function pageOrigin(): Promise<string | null> {
  const host = (await headers()).get('host')
  return siteOrigin() ?? (host ? `http://${host}` : null)
}

/**
 * What a shared page's metadata says of its item, or null when its link doesn't work. `path` is
 * the page's own, `/@<handle>/r/<id>/`, with its link image under it at `image/`.
 */
export type LinkPreview = { title: string; description: string; path: string; imageAlt: string }

/** A shared page's metadata: unlisted, and with its Open Graph and Twitter tags while it works. */
export async function linkPreviewMetadata(preview: LinkPreview | null): Promise<Metadata> {
  // Unlisted: never indexed, and no canonical, which the layout's would give it.
  const unlisted: Metadata = {
    robots: { index: false, follow: false },
    alternates: { canonical: null }
  }
  if (!preview) return { ...unlisted, title: 'Link not found · Farty' }
  const { title, description, path, imageAlt } = preview
  // Link previews need the image's absolute URL.
  const origin = await pageOrigin()
  // The image is a route of its own, not an `opengraph-image` file, whose URL Next would build
  // with the Handle's `@` escaped (#382).
  const image = { url: `${path}image/`, ...LINK_IMAGE_SIZE, alt: imageAlt, type: 'image/png' }
  return {
    ...unlisted,
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: `${title} · Farty`,
    description,
    openGraph: {
      title,
      description,
      url: path,
      siteName: 'Farty',
      type: 'website',
      images: [image]
    },
    twitter: { card: 'summary_large_image', title, description }
  }
}

/** The link image's size. */
export const LINK_IMAGE_SIZE = { width: 1200, height: 630 }

/** Not kept anywhere: a stopped link's image goes with it. */
const noStore = { 'Cache-Control': 'private, no-cache' }

/** The image of a link that doesn't work: none. */
export const linkImageNotFound = () => new Response('Not found', { status: 404, headers: noStore })

/**
 * A shared item's link image: Farty, with a pill at the top right when there is one (a
 * Recording's note), then its name, who shared it, and its loudness bars.
 */
export async function linkImage({
  name,
  byline,
  pill,
  levels,
  bars
}: {
  name: string
  byline: string
  pill: string | null
  levels: number[]
  /** How many flat bars to draw when there are no `levels`. */
  bars: number
}) {
  const logo = await logoDataUrl()
  const drawn = levels.length > 0 ? levels : Array<number>(bars).fill(0.05)
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
        {pill && (
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
            {pill}
          </div>
        )}
      </div>
      <div
        style={{
          display: 'block',
          marginTop: 56,
          fontSize: nameSize(name),
          letterSpacing: -nameSize(name) * 0.035,
          lineHeight: 1,
          // One line, so a long name never pushes the bars off the image.
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {name}
      </div>
      <div style={{ display: 'flex', marginTop: 28, fontSize: 52, opacity: 0.92 }}>{byline}</div>
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          gap: 7,
          marginTop: 40
        }}
      >
        {drawn.map((level, bar) => (
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
    { ...LINK_IMAGE_SIZE, headers: noStore }
  )
}

/**
 * The name's font size: big for a short name, such as "Recording 3", and smaller for a long one,
 * such as a Song's title, so most fit on the image's one line.
 */
function nameSize(name: string): number {
  if (name.length <= 14) return 116
  if (name.length <= 22) return 88
  return 68
}

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
