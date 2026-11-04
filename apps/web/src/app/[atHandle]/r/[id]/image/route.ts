import { linkParams } from '@/app/[atHandle]/link-params'
import { linkImage, linkImageNotFound } from '@/server/link-preview'
import { fartPhrase, sharedView } from '../shared'

// The shared Recording's link image (ADR 0020), 1200×630, which Messages, WhatsApp and the like
// show: Farty's pink, the name, the note, who shared it, and its waveform. Drawn from D1 on each
// request, so a link that stops working takes its image with it. The page names it in its Open
// Graph tags (`linkPreviewMetadata`).
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: RouteContext<'/[atHandle]/r/[id]/image'>
): Promise<Response> {
  const { handle, id } = await linkParams(params)
  const view = await sharedView(handle, id)
  if (!view) return linkImageNotFound()
  return linkImage({
    name: view.name,
    byline: `${fartPhrase(null)} by @${view.handle}`,
    // The bundled font has no ♯ and would fetch one from Google Fonts, so a sharp is spelled "#".
    pill: view.note?.replace('♯', '#') ?? null,
    levels: view.levels,
    bars: 40
  })
}
