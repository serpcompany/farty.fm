import type { Analysis, Trim } from '@/lib/recordings'
import { analyzeToAnalysis } from './port'
import { resampleToAnalysisRate } from './resample'
import { trimBounds } from './trimming'
import { answerRequests } from './worker-requests'

export interface AnalysisRequest {
  id: number
  samples: Float32Array
  sampleRate: number
  trim?: Trim
}

export type AnalysisReply = { analysis: Analysis } | { trim: Trim }

answerRequests<AnalysisRequest, AnalysisReply>(({ samples, sampleRate, trim }) =>
  trim
    ? {
        trim: trimBounds(
          resampleToAnalysisRate(samples, sampleRate),
          trim.startSeconds,
          trim.endSeconds
        )
      }
    : { analysis: analyzeToAnalysis(samples, sampleRate) }
)
