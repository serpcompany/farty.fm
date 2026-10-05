import Foundation
import Testing
@testable import RecordingAnalysisKit

/// #35: from the golden gesture, the Recording Pitch estimate within ±30 cents and non-null for
/// exactly the same Recordings. Also reports how closely the pitch contour agrees.
@Suite struct RecordingPitchTests {
    @Test func estimatesMatchTheGoldenData() throws {
        var maxErrorCents = 0.0
        var bitExact = 0, estimates = 0
        var framesTotal = 0, framesAgreeing = 0, framesVoicedInBoth = 0, framesVoicedInEither = 0
        var contourCents: [Double] = []
        var lines = [row("id", "estimate", "golden", "Δ cents", "conf", "golden", "contour")]
        for golden in Golden.recordings {
            let body = try gestureBody(golden)
            let pitch = RecordingPitch.analyze(body)

            // Contour agreement, frame by frame.
            let mine = pitch.f0.map { $0.isFinite ? hzToMIDI($0) : nil }
            #expect(mine.count == golden.pitchContour.frames, "\(golden.id): \(mine.count) contour frames")
            var agree = 0
            for (m, g) in zip(mine, golden.pitchContour.midi) {
                if (m == nil) == (g == nil) { agree += 1 }
                if let m, let g { framesVoicedInBoth += 1; contourCents.append(abs(m - g) * 100) }
                if m != nil || g != nil { framesVoicedInEither += 1 }
            }
            framesTotal += mine.count
            framesAgreeing += agree

            let rounded = (pitch.confidence * 100).rounded(.toNearestOrEven) / 100
            #expect((pitch.estimateMIDI == nil) == (golden.pitchEstimateMidi == nil),
                    "\(golden.id): estimate \(String(describing: pitch.estimateMIDI)), golden \(String(describing: golden.pitchEstimateMidi))")
            var cents = "-"
            if let mine = pitch.estimateMIDI, let theirs = golden.pitchEstimateMidi {
                if mine == theirs { bitExact += 1 }
                estimates += 1
                let error = abs(mine - theirs) * 100
                maxErrorCents = max(maxErrorCents, error)
                cents = String(format: "%.2f", error)
                #expect(error <= 30, "\(golden.id): estimate \(mine), golden \(theirs)")
            }
            #expect(abs(rounded - golden.pitchConfidence) < 1e-9, "\(golden.id): confidence \(rounded), golden \(golden.pitchConfidence)")
            lines.append(row(golden.id, pitch.estimateMIDI.map { String(format: "%.4f", $0) } ?? "nil",
                             golden.pitchEstimateMidi.map { String(format: "%.4f", $0) } ?? "nil", cents,
                             String(format: "%.2f", rounded), String(format: "%.2f", golden.pitchConfidence),
                             "\(agree)/\(mine.count)"))
        }
        let sortedCents = contourCents.sorted()
        let medianCents = sortedCents.isEmpty ? 0 : sortedCents[sortedCents.count / 2]
        lines.append("Recording Pitch: max estimate error \(String(format: "%.4f", maxErrorCents)) cents; \(bitExact)/\(estimates) estimates bit-identical to golden")
        lines.append("Contour: voicing agrees on \(framesAgreeing)/\(framesTotal) frames; voiced in both \(framesVoicedInBoth)/\(framesVoicedInEither) of frames voiced in either; median |Δ| \(String(format: "%.4f", medianCents)) cents, max |Δ| \(String(format: "%.4f", sortedCents.last ?? 0)) cents (golden contour is rounded to 0.01 cent)")
        print(lines.joined(separator: "\n"))
    }
}

/// The golden gesture of a fixture, cut from this package's own decode of the file.
func gestureBody(_ golden: Golden.Recording) throws -> [Double] {
    let y = try Golden.decoded(golden)
    return y[golden.gesture.startSample..<golden.gesture.endSample].map(Double.init)
}
