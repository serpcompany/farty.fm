import 'server-only'
import { downloadUrl, qrCode } from '@/lib/download-qr'

export function DownloadQr() {
  const url = downloadUrl()
  const { size, path } = qrCode(url)
  return (
    <svg
      role="img"
      aria-label={`QR code for ${new URL(url).host}`}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-52 rounded-lg"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
