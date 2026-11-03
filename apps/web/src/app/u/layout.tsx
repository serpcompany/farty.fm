import type { ReactNode } from 'react'
import { DownloadQr } from '@/components/farty/download-qr'
import { GetFartyFlow } from '@/components/farty/get-farty'

export default function SharedLayout({ children }: { children: ReactNode }) {
  return <GetFartyFlow qrCode={<DownloadQr />}>{children}</GetFartyFlow>
}
