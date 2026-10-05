import Foundation
import Testing
@testable import RecordingAnalysisKit

/// #36: from the golden gesture, contour and estimate, the same shortest note for every
/// Recording, and so the same Melodic set.
@Suite struct AuditionTests {
    static let expectedMelodic = ["013", "017", "019", "021", "059", "084", "086", "090", "094"]

    @Test func shortestNotesMatchTheGoldenData() throws {
        #expect(Golden.index.melodicRecordings == Self.expectedMelodic)
        var melodic: [String] = []
        var matches = 0
        var lines = [row("id", "shortest", "golden", "cents at 0.12 / 0.2 / 0.35 / 0.6 s")]
        for golden in Golden.recordings {
            guard let estimate = golden.pitchEstimateMidi else {
                // No estimate: Noise-like without audition.
                #expect(golden.shortestNoteS == nil && !golden.melodic)
                matches += 1
                continue
            }
            let body = try gestureBody(golden)
            let f0 = goldenContourHz(golden)
            let shortest = Audition.shortestNote(audio: body, f0: f0, referenceMIDI: estimate)
            let recordingPitch = shortest == nil ? nil : estimate
            if shortest == golden.shortestNoteS { matches += 1 }
            if shortest != nil { melodic.append(golden.id) }
            #expect(shortest == golden.shortestNoteS, "\(golden.id): shortest note \(String(describing: shortest)) s, golden \(String(describing: golden.shortestNoteS)) s")
            #expect(recordingPitch == golden.recordingPitchMidi, "\(golden.id): Recording Pitch")
            #expect((shortest != nil) == golden.melodic, "\(golden.id): Melodic")

            let cents = Audition.noteLengths.map { length in
                Audition.readBackCents(audio: body, f0: f0, referenceMIDI: estimate, length: length)
                    .map { String(format: "%.15g", $0) } ?? "unvoiced"
            }
            lines.append(row(golden.id, shortest.map { "\($0)" } ?? "nil", golden.shortestNoteS.map { "\($0)" } ?? "nil",
                             cents.joined(separator: " / ")))
        }
        #expect(melodic == Self.expectedMelodic)
        lines.append("Audition: shortest note matches \(matches)/\(Golden.recordings.count); Melodic: \(melodic.joined(separator: " "))")
        print(lines.joined(separator: "\n"))
    }

    /// The golden contour holds pYIN grid values rounded to 4 decimals. Snapping back to the
    /// grid recovers exactly what the reference holds, so this reports how much that matters.
    @Test func unsnappedGoldenContourGivesTheSameShortestNotes() throws {
        var matches = 0, candidates = 0
        for golden in Golden.recordings {
            guard let estimate = golden.pitchEstimateMidi else { continue }
            candidates += 1
            let f0 = golden.pitchContour.midi.map { $0.map(midiToHz) ?? .nan }
            let shortest = Audition.shortestNote(audio: try gestureBody(golden), f0: f0, referenceMIDI: estimate)
            if shortest == golden.shortestNoteS { matches += 1 }
            #expect(shortest == golden.shortestNoteS, "\(golden.id) with the 4-decimal contour: \(String(describing: shortest))")
        }
        print("Audition with the unsnapped 4-decimal golden contour: \(matches)/\(candidates) shortest notes match")
    }
}

/// The golden pitch contour in Hz, exactly as the reference engine holds it. Every voiced
/// contour value is a pYIN grid value (fmin × 2^(bin / 120), MIDI x.x259...) written with 4
/// decimals; snapping it to its bin recovers the full-precision value.
func goldenContourHz(_ golden: Golden.Recording) -> [Double] {
    let base = hzToMIDI(PYIN.fmin)
    return golden.pitchContour.midi.map { m in
        guard let m else { return .nan }
        let bin = Int(((m - base) * 10).rounded())
        let exact = hzToMIDI(PYIN.shared.freqs[bin])
        precondition(abs(exact - m) <= 0.00005 + 1e-9, "\(golden.id): \(m) is not on the pYIN grid")
        return midiToHz(exact)
    }
}
