import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { DownloadQr } from '@/components/pedos/download-qr'
import { GetFartyFlow } from '@/components/pedos/get-farty'
import { SiteFooter } from '@/components/pedos/site-chrome'
import { segmentHandle } from '@/lib/handle'

/**
 * Profile pages at `/@<handle>/` and the shared pages under them (#382). Every path whose first
 * segment no other page has comes here, so one with no `@` is the site's own 404. Get Farty runs
 * here, with the lander's QR code for a computer. Each page has the site's header, with Get Farty
 * in it, and they all have its footer (#441).
 */
export default async function HandleLayout({
  children,
  params
}: {
  children: ReactNode
  params: Promise<{ atHandle: string }>
}) {
  if (segmentHandle((await params).atHandle) === null) notFound()
  return (
    <GetFartyFlow qrCode={<DownloadQr />}>
      {children}
      <SiteFooter />
    </GetFartyFlow>
  )
}
