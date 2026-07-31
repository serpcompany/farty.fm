import Foundation
import MelodyRenderKit
import RecordingAnalysisKit

func makeCandidate(
    id: String,
    midiNote: Double?,
    url: URL = URL(fileURLWithPath: "/tmp/test-source.wav"),
    durationSeconds: Double = 1,
    rmsDBFS: Double = -18
) -> RecordingCandidate {
    RecordingCandidate(
        id: id,
        filename: url.lastPathComponent,
        url: url,
        permission: "test",
        analysis: RecordingAnalysisResult(
            durationSeconds: durationSeconds,
            soundBounds: SoundBounds(startSeconds: 0, endSeconds: durationSeconds),
            level: LevelAnalysis(rmsDBFS: rmsDBFS, peakDBFS: -6, envelope: []),
            pitch: PitchAnalysis(
                referenceFrequencyHz: midiNote.map { 440 * pow(2, ($0 - 69) / 12) },
                referenceMIDINote: midiNote,
                voicedFrameRatio: midiNote == nil ? 0 : 1,
                periodicityEvidence: midiNote == nil ? 0 : 1,
                frames: []
            )
        )
    )
}
