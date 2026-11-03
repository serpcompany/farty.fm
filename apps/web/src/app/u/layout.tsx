import type { ReactNode } from 'react'
import { DownloadQr } from '@/components/pedos/download-qr'
import { GetFartyFlow } from '@/components/pedos/get-farty'

/** Shared pages and profile pages: Get Farty runs here, with the lander's QR code for a computer. */
export default function SharedLayout({ children }: { children: ReactNode }) {
  return <GetFartyFlow qrCode={<DownloadQr />}>{children}</GetFartyFlow>
}
