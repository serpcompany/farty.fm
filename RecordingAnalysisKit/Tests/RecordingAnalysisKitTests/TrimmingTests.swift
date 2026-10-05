import Foundation
import Testing
@testable import RecordingAnalysisKit

/// #34: from each fixture file, the gesture bounds within ±10 ms and the same "cut at re-attack".
@Suite struct TrimmingTests {
    @Test func decodedLengthsMatchTheReference() throws {
        for golden in Golden.recordings {
            let y = try Golden.decoded(golden)
            let expected = golden.file.sampleRate == analysisSampleRate
                ? golden.file.frames
                : Int((Double(golden.file.frames) * Double(analysisSampleRate) / Double(golden.file.sampleRate)).rounded(.up))
            #expect(y.count == expected, "\(golden.id): decoded \(y.count) samples, reference \(expected)")
        }
    }

    @Test func gesturesMatchTheGoldenData() throws {
        var maxErrorMS = 0.0
        var lines = [row("id", "start s", "golden", "end s", "golden", "Δ ms", "cut", "golden")]
        for golden in Golden.recordings {
            let gesture = Trimming.noteSegment(try Golden.decoded(golden))
            let sr = Double(analysisSampleRate)
            let startS = Double(gesture.start) / sr
            let endS = Double(gesture.end) / sr
            let errorMS = max(abs(startS - golden.gesture.startS), abs(endS - golden.gesture.endS)) * 1000
            maxErrorMS = max(maxErrorMS, errorMS)
            lines.append(row(golden.id, fmt(startS), fmt(golden.gesture.startS), fmt(endS), fmt(golden.gesture.endS),
                             String(format: "%.2f", errorMS), gesture.cutAtReattack, golden.gesture.cutAtReattack))
            #expect(abs(startS - golden.gesture.startS) <= 0.010, "\(golden.id): start \(startS) s, golden \(golden.gesture.startS) s")
            #expect(abs(endS - golden.gesture.endS) <= 0.010, "\(golden.id): end \(endS) s, golden \(golden.gesture.endS) s")
            #expect(gesture.cutAtReattack == golden.gesture.cutAtReattack, "\(golden.id): cut at re-attack")
        }
        lines.append("Trimming: max gesture error \(String(format: "%.2f", maxErrorMS)) ms over \(Golden.recordings.count) Recordings")
        print(lines.joined(separator: "\n"))
    }
}

func fmt(_ x: Double) -> String { String(format: "%.6f", x) }
