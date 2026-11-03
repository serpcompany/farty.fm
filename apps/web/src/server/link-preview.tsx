import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { ImageResponse } from 'next/og'
import { siteOrigin } from '@/lib/site'

export async function pageOrigin(): Promise<string | null> {
  const host = (await headers()).get('host')
  return siteOrigin() ?? (host ? `http://${host}` : null)
}

type LinkPreview = { title: string; description: string; path: string }

export async function linkPreviewMetadata(preview: LinkPreview | null): Promise<Metadata> {
  const unlisted: Metadata = {
    robots: { index: false, follow: false },
    alternates: { canonical: null }
  }
  if (!preview) return { ...unlisted, title: 'Link not found · Farty' }
  const { title, description, path } = preview
  const origin = await pageOrigin()
  return {
    ...unlisted,
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: `${title} · Farty`,
    description,
    openGraph: { title, description, url: path, siteName: 'Farty', type: 'website' },
    twitter: { card: 'summary_large_image', title, description }
  }
}

export const LINK_IMAGE_SIZE = { width: 1200, height: 630 }

const noStore = { 'Cache-Control': 'private, no-cache' }

export const linkImageNotFound = () => new Response('Not found', { status: 404, headers: noStore })

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
        {Array.from(drawn.entries(), ([bar, level]) => (
          <div
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

function nameSize(name: string): number {
  if (name.length <= 14) return 116
  if (name.length <= 22) return 88
  return 68
}

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
