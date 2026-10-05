import Foundation
import RecordingAnalysisKit

/// Renders a Toot: a Song played by the user's Recordings, with the Arrangement Auto-map chose,
/// through the reference engine's renderer (`RecordingAnalysisKit.Renderer`).
///
/// Fart-only (ADR 0004): every sample comes from the Recordings' own audio, trimmed to each one's
/// single clean gesture, resampled to each note, faded, set in level and mixed.
enum TootRenderer {
    /// Where one of the Song's notes landed in the audio.
    struct Note: Hashable, Sendable {
        let startSeconds: Double
        /// How long the note sounds, at most its written length minus a short gap.
        let lengthSeconds: Double
        /// The note it plays, as a MIDI note number.
        let targetMIDI: Double
    }

    struct Output: Hashable, Sendable {
        /// The audio's length in seconds: the Song plus a second for the last note to ring.
        let seconds: Double
        /// The Song's notes, in order.
        let notes: [Note]
    }

    enum Failure: Error, Hashable {
        /// A Recording the Arrangement uses is gone, or isn't a Melodic Recording.
        case recordingUnavailable(Recording.ID)
    }

    /// Renders `song` with `arrangement`, played by `recordings` (at least every one it uses),
    /// and writes it to `url` as mono 44.1 kHz AAC.
    ///
    /// Synchronous and CPU-bound: run it off the main actor.
    static func render(_ song: Song, arrangement: Arrangement, recordings: [Recording], to url: URL) throws -> Output {
        let used = Set(arrangement.recordingForPitch.values)
        var sources: [Recording.ID: Renderer.Source] = [:]
        // Each source decodes its file and tracks its pitch, which is most of the work.
        let results = used.map { id in (id, recordings.first { $0.id == id }) }
        let built = UnsafeSendableBox([Result<Renderer.Source, Error>?](repeating: nil, count: results.count))
        DispatchQueue.concurrentPerform(iterations: results.count) { index in
            let (id, recording) = results[index]
            built.set(index, Result { try source(of: recording, id: id) })
        }
        for (index, (id, _)) in results.enumerated() {
            sources[id] = try built.values[index]!.get()
        }

        let notes = try song.notes.map { note in
            guard let id = arrangement.recording(playing: note), let source = sources[id] else {
                throw Failure.recordingUnavailable(arrangement.recording(playing: note) ?? UUID())
            }
            return Renderer.Note(
                source: source,
                targetMIDI: Double(arrangement.soundingPitch(note.pitch)),
                startBeats: note.start,
                lengthBeats: note.length,
                bpm: Double(song.bpm),
                beatsPerBar: Double(song.beatsPerBar)
            )
        }
        let output = Renderer.render(notes, songSeconds: Renderer.songSeconds(lengthBeats: song.beats, bpm: Double(song.bpm)))
        try Renderer.write(output.samples, to: url)

        let sampleRate = Double(Renderer.sampleRate)
        return Output(
            seconds: Double(output.samples.count) / sampleRate,
            notes: zip(notes, output.notes).map { note, placed in
                Note(
                    startSeconds: Double(placed.startSample) / sampleRate,
                    lengthSeconds: Double(placed.lengthSamples) / sampleRate,
                    targetMIDI: note.targetMIDI
                )
            }
        )
    }

    /// A Melodic Recording's gesture and pitch contour, cut from its file at its analysis's bounds.
    private static func source(of recording: Recording?, id: Recording.ID) throws -> Renderer.Source {
        guard let recording, let url = recording.audioURL, case .analyzed(let analysis) = recording.analysis,
              let pitch = analysis.pitch
        else { throw Failure.recordingUnavailable(id) }
        return try RecordingAnalyzer.renderSource(
            fileAt: url,
            gestureStartSeconds: analysis.startSeconds,
            gestureEndSeconds: analysis.endSeconds ?? recording.seconds,
            recordingPitchMIDI: pitch
        )
    }
}

/// Results written by `concurrentPerform`, each index by one iteration only.
private final class UnsafeSendableBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var values: [Value?]

    init(_ values: [Value?]) {
        self.values = values
    }

    func set(_ index: Int, _ value: Value) {
        lock.withLock { values[index] = value }
    }
}
