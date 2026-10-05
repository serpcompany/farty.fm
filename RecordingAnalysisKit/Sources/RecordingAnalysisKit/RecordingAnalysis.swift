import Foundation

/// What Recording Analysis knows about one Recording. Store it next to the Recording and
/// re-run the analysis when `version` is older than `currentVersion`.
public struct RecordingAnalysis: Codable, Hashable, Sendable {
    /// Bumped whenever the analysis would give different results.
    public static let currentVersion = 1

    public let version: Int
    /// Start of the single clean gesture, in seconds from the start of the file.
    public let gestureStartSeconds: Double
    /// End of the gesture (exclusive), in seconds from the start of the file.
    public let gestureEndSeconds: Double
    /// The gesture ends at a second attack: the Recording held more than one fart and only
    /// the first is used ("first fart used").
    public let cutAtReattack: Bool
    /// The Recording Pitch estimate before audition, in MIDI (60 = middle C).
    public let pitchEstimateMIDI: Double?
    /// 0 to 1, rounded to 2 decimals.
    public let pitchConfidence: Double
    /// The Recording Pitch in MIDI. Non-nil exactly when the Recording is Melodic; nil means
    /// Noise-like.
    public let recordingPitchMIDI: Double?
    /// The shortest note (0.12, 0.2, 0.35 or 0.6 s) the Recording can play and still read back
    /// on pitch. Nil for Noise-like Recordings.
    public let shortestNoteSeconds: Double?
}

public enum RecordingAnalyzer {
    /// Decodes the file to mono 44.1 kHz and runs the whole reference analysis.
    ///
    /// Synchronous and CPU-bound: call it off the main actor. It keeps no shared state, so
    /// several Recordings can be analyzed concurrently.
    public static func analyze(fileAt url: URL) throws -> RecordingAnalysis {
        analyze(samples: try AudioDecoder.decodeMono(fileAt: url))
    }

    /// The whole analysis of a decoded Recording (mono, 44.1 kHz).
    static func analyze(samples y: [Float]) -> RecordingAnalysis {
        let gesture = Trimming.noteSegment(y)
        let body = y[gesture.start..<gesture.end].map(Double.init)
        let pitch = RecordingPitch.analyze(body)
        let shortestNote = pitch.estimateMIDI.flatMap {
            Audition.shortestNote(audio: body, f0: pitch.f0, referenceMIDI: $0)
        }
        let sr = Double(analysisSampleRate)
        return RecordingAnalysis(
            version: RecordingAnalysis.currentVersion,
            gestureStartSeconds: Double(gesture.start) / sr,
            gestureEndSeconds: Double(gesture.end) / sr,
            cutAtReattack: gesture.cutAtReattack,
            pitchEstimateMIDI: pitch.estimateMIDI,
            pitchConfidence: (pitch.confidence * 100).rounded(.toNearestOrEven) / 100,
            recordingPitchMIDI: shortestNote == nil ? nil : pitch.estimateMIDI,
            shortestNoteSeconds: shortestNote
        )
    }
}
