import AVFAudio
import Foundation
import MelodyRenderKit
import XCTest

final class FartOnlyRendererTests: XCTestCase {
    func testRenderProducesDeterministicLimitedPCMAndPreservesRests() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("MelodyRenderKitTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let sourceURL = directory.appendingPathComponent("source.wav")
        let firstOutputURL = directory.appendingPathComponent("first.wav")
        let secondOutputURL = directory.appendingPathComponent("second.wav")
        try writeMonoWAV(
            samples: Array(repeating: 1, count: 441),
            sampleRate: FartOnlyRenderer.sampleRate,
            url: sourceURL
        )
        let melody = CuratedMelody(
            id: "render-contract",
            title: "Render Contract",
            provenance: "Test fixture",
            bpm: 60,
            events: [MelodyEvent(60, 0.01), MelodyEvent(nil, 0.01)]
        )
        let sourceSet = try MelodyFitPlanner.sourceSet(
            mode: .chooseIndividual,
            melody: melody,
            candidates: [
                makeCandidate(
                    id: "source",
                    midiNote: 60,
                    url: sourceURL,
                    durationSeconds: 0.004,
                    rmsDBFS: -60
                )
            ]
        )

        let evidence = try FartOnlyRenderer.render(
            melody: melody,
            sourceSet: sourceSet,
            outputURL: firstOutputURL
        )
        _ = try FartOnlyRenderer.render(
            melody: melody,
            sourceSet: sourceSet,
            outputURL: secondOutputURL
        )
        let first = try readMonoWAV(firstOutputURL)
        let second = try readMonoWAV(secondOutputURL)

        XCTAssertEqual(first.sampleRate, FartOnlyRenderer.sampleRate)
        XCTAssertEqual(first.samples.count, 882)
        XCTAssertEqual(first.samples, second.samples)
        XCTAssertTrue(first.samples.allSatisfy(\.isFinite))
        XCTAssertLessThanOrEqual(first.samples.map { abs($0) }.max() ?? 0, 0.960_001)
        XCTAssertGreaterThan(first.samples[..<441].map { abs($0) }.max() ?? 0, 0.95)
        XCTAssertTrue(first.samples[441...].allSatisfy { $0 == 0 })
        XCTAssertEqual(evidence.renderer, FartOnlyRenderer.algorithmID)
        XCTAssertEqual(evidence.outputFilename, "first.wav")
        XCTAssertEqual(evidence.sourceMode, .chooseIndividual)
        XCTAssertEqual(evidence.assignmentPolicy, "single-source-control")
        XCTAssertEqual(evidence.individualRecordingID, "source")
        XCTAssertEqual(evidence.assignments.map(\.recordingID), ["source"])
        XCTAssertEqual(evidence.fit.selectedRecordingIDs, ["source"])
        XCTAssertEqual(evidence.fit.usedRecordingIDs, ["source"])
        XCTAssertEqual(evidence.fit.noteAssignmentCount, 1)
        XCTAssertEqual(evidence.fit.meanAbsoluteSemitoneShift, 0)
        XCTAssertEqual(evidence.fit.maximumAbsoluteSemitoneShift, 0)
        XCTAssertEqual(evidence.fit.repeatedOrPaddedNoteCount, 1)
        XCTAssertEqual(
            evidence.fit.warnings,
            ["At least one source region is shorter than its note and requires ping-pong repetition or padding."]
        )
    }

    private func writeMonoWAV(samples: [Float], sampleRate: Double, url: URL) throws {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1))
        let buffer = try XCTUnwrap(
            AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))
        )
        let channel = try XCTUnwrap(buffer.floatChannelData?[0])
        buffer.frameLength = AVAudioFrameCount(samples.count)
        for index in samples.indices {
            channel[index] = samples[index]
        }
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        try file.write(from: buffer)
    }

    private func readMonoWAV(_ url: URL) throws -> (sampleRate: Double, samples: [Float]) {
        let file = try AVAudioFile(forReading: url)
        let buffer = try XCTUnwrap(
            AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))
        )
        try file.read(into: buffer)
        let channel = try XCTUnwrap(buffer.floatChannelData?[0])
        return (
            file.processingFormat.sampleRate,
            Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
        )
    }
}
