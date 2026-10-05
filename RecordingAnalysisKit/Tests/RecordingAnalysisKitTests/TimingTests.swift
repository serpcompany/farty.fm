import Foundation
import Testing
@testable import RecordingAnalysisKit

/// The budget is under 1 s per 5 s Recording on an iPhone. Timings only mean something in
/// optimized builds, so this suite runs with `swift test -c release`.
@Suite(.serialized, .enabled(if: optimizedBuild, "timings need an optimized build: swift test -c release"))
struct TimingTests {
    /// The worst case for a 5 s Recording: the whole 5 s is one gesture, so pYIN runs over all
    /// of it, and audition renders and reads back all four note lengths. The input is a fixture's
    /// gesture repeated to 5 s in memory; it is test input only and is never played.
    @Test func fiveSecondGestureWorstCase() throws {
        let golden = Golden.recordings.first { $0.id == "059" }!
        let gesture = try gestureBody(golden)
        let body = (0..<(5 * analysisSampleRate)).map { gesture[$0 % gesture.count] }
        let samples = body.map(Float.init)

        let clock = ContinuousClock()
        var stages: [Duration] = []
        var best = Duration.seconds(1000)
        for _ in 0..<5 {
            let t0 = clock.now
            _ = Trimming.noteSegment(samples)
            let t1 = clock.now
            let pitch = RecordingPitch.analyze(body)
            let t2 = clock.now
            for length in Audition.noteLengths {
                _ = Audition.readBackCents(audio: body, f0: pitch.f0, referenceMIDI: pitch.estimateMIDI ?? 60, length: length)
            }
            let t3 = clock.now
            if t3 - t0 < best {
                best = t3 - t0
                stages = [t1 - t0, t2 - t1, t3 - t2]
            }
        }
        print("Timing (release), 5 s gesture worst case: \(ms(best)) (best of 5): trimming \(ms(stages[0])), pitch contour \(ms(stages[1])), audition of all 4 note lengths \(ms(stages[2]))")
        #expect(best < .seconds(1))
    }

    /// `RecordingAnalyzer.analyze(fileAt:)` on every fixture, decoding included.
    @Test func analyzeEveryFixtureFile() throws {
        let clock = ContinuousClock()
        var slowest = (id: "", duration: Duration.zero, seconds: 0.0)
        var total = Duration.zero
        for golden in Golden.recordings {
            let url = Golden.fileURL(golden)
            var best = Duration.seconds(1000)
            for _ in 0..<3 {
                best = min(best, try clock.measure { _ = try RecordingAnalyzer.analyze(fileAt: url) })
            }
            total += best
            if best > slowest.duration {
                slowest = (golden.id, best, Double(golden.file.frames) / Double(golden.file.sampleRate))
            }
        }
        print("Timing (release), analyze(fileAt:) on all 23 fixtures: \(ms(total)) in total; slowest \(slowest.id) (\(String(format: "%.2f", slowest.seconds)) s file) \(ms(slowest.duration))")
        #expect(slowest.duration < .seconds(1))
    }
}

#if DEBUG
    private let optimizedBuild = false
#else
    private let optimizedBuild = true
#endif

private func ms(_ d: Duration) -> String {
    let c = d.components
    return String(format: "%.1f ms", Double(c.seconds) * 1000 + Double(c.attoseconds) / 1e15)
}
