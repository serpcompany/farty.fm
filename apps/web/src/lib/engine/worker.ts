import { answerRequests } from '@/lib/analysis/worker-requests'
import type { Arrangement } from './auto-map'
import { type RecordingToRender, type RenderedSong, renderFromRecordings } from './render-song'
import type { Song } from './song'

export interface RenderRequest {
  id: number
  song: Song
  arrangement: Arrangement
  recordings: RecordingToRender[]
}

answerRequests<RenderRequest, RenderedSong>(
  ({ song, arrangement, recordings }) => renderFromRecordings(song, arrangement, recordings),
  rendered => [rendered.samples.buffer]
)
