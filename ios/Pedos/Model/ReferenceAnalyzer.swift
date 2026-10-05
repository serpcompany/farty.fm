import Foundation
import RecordingAnalysisKit

extension LiveRecordingSource.Analyzer {
    /// Recording Analysis ported from the reference engine (`RecordingAnalysisKit`, which matches
    /// `tools/melody-lab/` on all 23 Fixture Library Recordings).
    static let reference = LiveRecordingSource.Analyzer(version: RecordingAnalysisKit.RecordingAnalysis.currentVersion) { url in
        let result = try RecordingAnalysisKit.RecordingAnalyzer.analyze(fileAt: url)
        return SavedAnalysis(
            version: result.version,
            gestureStartSeconds: result.gestureStartSeconds,
            gestureEndSeconds: result.gestureEndSeconds,
            cutAtReattack: result.cutAtReattack,
            pitchEstimateMIDI: result.pitchEstimateMIDI,
            pitchConfidence: result.pitchConfidence,
            recordingPitchMIDI: result.recordingPitchMIDI,
            shortestNoteSeconds: result.shortestNoteSeconds
        )
    }
}
