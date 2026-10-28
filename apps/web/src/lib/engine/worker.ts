/// <reference lib="webworker" />
import type { Arrangement } from './auto-map'
import { type RecordingToRender, renderFromRecordings } from './render-song'
import type { Song } from './song'

export interface RenderRequest {
  id: number
  song: Song
  arrangement: Arrangement
  recordings: RecordingToRender[]
}

/** Renders Songs off the page's thread. One request at a time, answered by id. */
self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const { id, song, arrangement, recordings } = event.data
  try {
    const rendered = renderFromRecordings(song, arrangement, recordings)
    // The audio moves to the page instead of being copied.
    self.postMessage({ id, rendered }, [rendered.samples.buffer])
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
