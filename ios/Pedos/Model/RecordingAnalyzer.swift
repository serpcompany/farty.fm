import Foundation

extension LiveRecordingSource.Analyzer {
    /// Recording Analysis ported from the reference engine (`RecordingAnalysisKit`).
    /// Placeholder until the port lands in this branch: every analysis fails.
    static let reference = LiveRecordingSource.Analyzer(version: 0) { _ in
        throw CocoaError(.featureUnsupported)
    }
}
