import Foundation
import Testing
@testable import RecordingAnalysisKit

@Suite("RecordingAudioAnalyzer")
struct RecordingAudioAnalyzerTests {
    private let sampleRate = 44_100.0

    @Test("reports exact duration")
    func duration() throws {
        let samples = Array(repeating: Float(0.25), count: 44_100)
        let result = try RecordingAudioAnalyzer.analyze(samples: samples, sampleRate: sampleRate)
        #expect(abs(result.durationSeconds - 1) < 0.000_001)
    }

    @Test("finds a controlled sound interval without changing duration")
    func soundBounds() throws {
        let lead = Array(repeating: Float.zero, count: 8_820)
        let sound = sine(frequency: 110, amplitude: 0.5, duration: 0.4)
        let tail = Array(repeating: Float.zero, count: 8_820)
        let result = try RecordingAudioAnalyzer.analyze(
            samples: lead + sound + tail,
            sampleRate: sampleRate
        )

        let bounds = try #require(result.soundBounds)
        #expect(abs(result.durationSeconds - 0.8) < 0.000_001)
        #expect(abs(bounds.startSeconds - 0.19) < 0.025)
        #expect(abs(bounds.endSeconds - 0.61) < 0.025)
    }

    @Test("reports RMS and peak in dBFS")
    func level() throws {
        let result = try RecordingAudioAnalyzer.analyze(
            samples: sine(frequency: 110, amplitude: 0.5, duration: 1),
            sampleRate: sampleRate
        )

        #expect(abs(result.level.peakDBFS - -6.02) < 0.1)
        #expect(abs(result.level.rmsDBFS - -9.03) < 0.15)
        #expect(!result.level.envelope.isEmpty)
    }

    @Test("estimates controlled fundamental pitch")
    func pitch() throws {
        let result = try RecordingAudioAnalyzer.analyze(
            samples: sine(frequency: 110, amplitude: 0.5, duration: 1),
            sampleRate: sampleRate
        )

        let frequency = try #require(result.pitch.referenceFrequencyHz)
        #expect(abs(frequency - 110) < 1)
        #expect(result.pitch.isAvailable)
        #expect(result.pitch.voicedFrameRatio > 0.9)
    }

    @Test("does not invent pitch for silence")
    func unavailablePitch() throws {
        let result = try RecordingAudioAnalyzer.analyze(
            samples: Array(repeating: 0, count: 44_100),
            sampleRate: sampleRate
        )

        #expect(result.soundBounds == nil)
        #expect(!result.pitch.isAvailable)
        #expect(result.pitch.referenceFrequencyHz == nil)
    }

    private func sine(frequency: Double, amplitude: Float, duration: Double) -> [Float] {
        let count = Int(duration * sampleRate)
        return (0..<count).map { index in
            amplitude * Float(sin(2 * .pi * frequency * Double(index) / sampleRate))
        }
    }
}
