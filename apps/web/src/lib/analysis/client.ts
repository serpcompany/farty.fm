import type { Analysis, Trim } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import type { AnalysisReply, AnalysisRequest } from './worker'
import { workerRequests } from './worker-requests'

const requestAnalysis = workerRequests<AnalysisRequest, AnalysisReply>(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  'Analysis failed'
)

function ask(audio: PcmAudio, trim?: Trim): Promise<AnalysisReply> {
  return requestAnalysis({ samples: audio.samples.slice(), sampleRate: audio.sampleRate, trim })
}

export async function analyze(audio: PcmAudio): Promise<Analysis> {
  const reply = await ask(audio)
  if (!('analysis' in reply)) throw new Error('Analysis failed')
  return reply.analysis
}

export async function findTrim(audio: PcmAudio, handles: Trim): Promise<Trim> {
  const reply = await ask(audio, handles)
  if (!('trim' in reply)) throw new Error('Trim failed')
  return reply.trim
}
