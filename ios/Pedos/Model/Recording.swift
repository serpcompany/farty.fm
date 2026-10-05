import Foundation

/// A single saved fart clip (see `CONTEXT.md`).
struct Recording: Identifiable, Hashable, Sendable {
    let id: UUID
    /// Recordings are named "Recording 1, 2, …" and can't be renamed in the MVP.
    let number: Int
    /// Length in seconds.
    let seconds: Double
    var analysis: AnalysisState
    /// The audio to play, when the build has any.
    let audioURL: URL?

    var name: String { "Recording \(number)" }

    /// The Recording Pitch as a MIDI note number, when it has been analyzed as Melodic.
    var pitch: Double? {
        if case .analyzed(let result) = analysis { result.pitch } else { nil }
    }

    var isMelodic: Bool { pitch != nil }

    /// What replay plays: the fart itself, from where it starts to where it ends (before a second
    /// fart, if there is one), or nil for the whole file. The file itself is never cut.
    var replaySegment: Segment? {
        guard case .analyzed(let result) = analysis else { return nil }
        let end = min(result.endSeconds ?? seconds, seconds)
        guard result.startSeconds < end, result.startSeconds > 0 || end < seconds else { return nil }
        return Segment(start: result.startSeconds, length: end - result.startSeconds)
    }
}

/// Where a Recording's Recording Analysis stands. Saving never waits for it (ADR 0002).
enum AnalysisState: Hashable, Sendable {
    case analyzing
    /// The analysis failed; the Recording is kept and can be analyzed again.
    case notAnalyzed
    case analyzed(RecordingAnalysis)
}

/// What Recording Analysis found in a Recording.
struct RecordingAnalysis: Hashable, Sendable {
    /// The Recording Pitch as a fractional MIDI note number, or nil for a Noise-like Recording.
    let pitch: Double?
    /// More than one fart was heard, so only the first one is used.
    let firstFartUsed: Bool
    /// Where the fart starts and ends in the file, in seconds: replay plays just that, so there's
    /// no dead air before or after it. Nil end: the end of the file.
    var startSeconds: Double = 0
    var endSeconds: Double? = nil
    /// The shortest note a Melodic Recording plays on pitch, in seconds: Auto-map keeps it off
    /// notes too short for it.
    var shortestNoteSeconds: Double? = nil

    var isMelodic: Bool { pitch != nil }
}

/// A just-recorded take that hasn't been saved or discarded yet.
struct Draft: Identifiable, Hashable, Sendable {
    let id: UUID
    let seconds: Double
    let audioURL: URL?
    /// Loudness bars for the Review waveform, each 0...1.
    let waveform: [Float]
}

/// Formats a length in seconds the way rows and Review show it: "1.1 s".
func formattedLength(_ seconds: Double) -> String {
    seconds.formatted(.number.precision(.fractionLength(1))) + " s"
}
