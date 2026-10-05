import AVFAudio
import Foundation
import Testing
import RecordingAnalysisKit

/// From each fixture file, through the public API only: the same gestures, Melodic set,
/// Recording Pitches (within 30 cents) and shortest notes as the reference.
@Suite struct EndToEndTests {
    @Test func analyzeEveryFixtureFile() throws {
        var melodic: [String] = []
        var maxGestureErrorMS = 0.0, maxPitchErrorCents = 0.0
        var lines = [row("id", "start s", "end s", "cut", "pitch", "golden", "shortest", "conf")]
        for golden in Golden.recordings {
            let analysis = try RecordingAnalyzer.analyze(fileAt: Golden.fileURL(golden))
            #expect(analysis.version == RecordingAnalysis.currentVersion)

            let gestureError = max(abs(analysis.gestureStartSeconds - golden.gesture.startS),
                                   abs(analysis.gestureEndSeconds - golden.gesture.endS)) * 1000
            maxGestureErrorMS = max(maxGestureErrorMS, gestureError)
            #expect(gestureError <= 10, "\(golden.id): gesture off by \(gestureError) ms")
            #expect(analysis.cutAtReattack == golden.gesture.cutAtReattack, "\(golden.id): cut at re-attack")

            #expect((analysis.recordingPitchMIDI != nil) == golden.melodic, "\(golden.id): Melodic")
            if let mine = analysis.recordingPitchMIDI, let theirs = golden.recordingPitchMidi {
                let cents = abs(mine - theirs) * 100
                maxPitchErrorCents = max(maxPitchErrorCents, cents)
                #expect(cents <= 30, "\(golden.id): Recording Pitch \(mine), golden \(theirs)")
                melodic.append(golden.id)
            }
            #expect((analysis.pitchEstimateMIDI == nil) == (golden.pitchEstimateMidi == nil), "\(golden.id): estimate")
            #expect(analysis.shortestNoteSeconds == golden.shortestNoteS, "\(golden.id): shortest note")
            #expect(abs(analysis.pitchConfidence - golden.pitchConfidence) < 1e-9, "\(golden.id): confidence")

            lines.append(row(golden.id, fmt(analysis.gestureStartSeconds), fmt(analysis.gestureEndSeconds), analysis.cutAtReattack,
                             analysis.recordingPitchMIDI.map { String(format: "%.4f", $0) } ?? "Noise-like",
                             golden.recordingPitchMidi.map { String(format: "%.4f", $0) } ?? "Noise-like",
                             analysis.shortestNoteSeconds.map { "\($0)" } ?? "-", analysis.pitchConfidence))
        }
        #expect(melodic == Golden.index.melodicRecordings)
        lines.append("End to end: max gesture error \(String(format: "%.2f", maxGestureErrorMS)) ms, max Recording Pitch error \(String(format: "%.4f", maxPitchErrorCents)) cents, Melodic \(melodic.count)/\(Golden.recordings.count): \(melodic.joined(separator: " "))")
        print(lines.joined(separator: "\n"))
    }

    /// The app records 44.1 kHz mono AAC `.m4a`. AAC adds encoder priming, which decoding must
    /// remove or every gesture would shift. Each fixture is encoded that way into a temporary
    /// file (test input only) and analyzed from there.
    @Test func aacRecordingsDecodeWithoutOffset() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "RecordingAnalysisKitTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        var maxGestureErrorMS = 0.0, maxPitchErrorCents = 0.0
        var melodic: [String] = [], shortestDiffers: [String] = []
        for golden in Golden.recordings {
            let original = try Golden.decoded(golden)
            let url = dir.appending(path: "\(golden.id).m4a")
            try writeAAC(original, to: url)
            let lengthInFile = try AVAudioFile(forReading: url).length
            #expect(lengthInFile == AVAudioFramePosition(original.count), "\(golden.id): \(lengthInFile) frames after AAC, \(original.count) before")

            let analysis = try RecordingAnalyzer.analyze(fileAt: url)
            let gestureError = max(abs(analysis.gestureStartSeconds - golden.gesture.startS),
                                   abs(analysis.gestureEndSeconds - golden.gesture.endS)) * 1000
            maxGestureErrorMS = max(maxGestureErrorMS, gestureError)
            #expect(gestureError <= 10, "\(golden.id): gesture off by \(gestureError) ms after AAC")
            if let mine = analysis.recordingPitchMIDI {
                melodic.append(golden.id)
                if let theirs = golden.recordingPitchMidi { maxPitchErrorCents = max(maxPitchErrorCents, abs(mine - theirs) * 100) }
            }
            if analysis.shortestNoteSeconds != golden.shortestNoteS { shortestDiffers.append(golden.id) }
        }
        print("AAC .m4a (lossy, test input only): max gesture error \(String(format: "%.2f", maxGestureErrorMS)) ms; Melodic \(melodic.joined(separator: " ")) (golden \(Golden.index.melodicRecordings.joined(separator: " "))); max Recording Pitch error \(String(format: "%.2f", maxPitchErrorCents)) cents; shortest note differs for: \(shortestDiffers.isEmpty ? "none" : shortestDiffers.joined(separator: " "))")
    }

    @Test func analysisSurvivesAJSONRoundTrip() throws {
        let golden = Golden.recordings.first { $0.id == "017" }!
        let analysis = try RecordingAnalyzer.analyze(fileAt: Golden.fileURL(golden))
        let decoded = try JSONDecoder().decode(RecordingAnalysis.self, from: JSONEncoder().encode(analysis))
        #expect(decoded == analysis)
    }

    @Test func unreadableFileThrows() {
        #expect(throws: (any Error).self) {
            try RecordingAnalyzer.analyze(fileAt: Golden.goldenDir.appending(path: "index.json"))
        }
    }
}

/// Writes mono 44.1 kHz AAC, the format AVAudioRecorder saves Recordings in.
private func writeAAC(_ samples: [Float], to url: URL) throws {
    let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
    ]
    let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(samples.count))!
    samples.withUnsafeBufferPointer { buffer.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
    buffer.frameLength = AVAudioFrameCount(samples.count)
    try file.write(from: buffer)
    file.close()
}
