import type { Analysis } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import type { AnalysisRequest } from './worker'
import { workerRequests } from './worker-requests'

const requestAnalysis = workerRequests<AnalysisRequest, Analysis>(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  'Analysis failed'
)

export function analyze(audio: PcmAudio): Promise<Analysis> {
  return requestAnalysis({ samples: audio.samples.slice(), sampleRate: audio.sampleRate })
}
