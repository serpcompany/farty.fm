import type { Analysis } from '@/lib/recordings'
import { analyzeToAnalysis } from './port'
import { answerRequests } from './worker-requests'

export interface AnalysisRequest {
  id: number
  samples: Float32Array
  sampleRate: number
}

answerRequests<AnalysisRequest, Analysis>(({ samples, sampleRate }) =>
  analyzeToAnalysis(samples, sampleRate)
)
