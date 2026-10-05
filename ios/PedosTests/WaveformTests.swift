import AVFAudio
import XCTest
@testable import Pedos

/// The Recordings tab draws only the cropped fart: `Waveform.levels` over a segment.
final class WaveformTests: XCTestCase {
    private var file: URL!

    /// One second of silence, a loud 0.2 s in the middle (0.4 to 0.6 s), then silence.
    override func setUpWithError() throws {
        file = URL.temporaryDirectory.appending(path: "WaveformTests-\(UUID().uuidString).caf")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1))
        let output = try AVAudioFile(forWriting: file, settings: format.settings)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100))
        buffer.frameLength = 44_100
        let samples = try XCTUnwrap(buffer.floatChannelData?[0])
        for i in 0..<44_100 { samples[i] = (17_640..<26_460).contains(i) ? 0.8 : 0 }
        try output.write(from: buffer)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: file)
    }

    func testTheWholeFileShowsTheSilenceAroundTheSound() {
        let levels = Waveform.levels(of: file, count: 10)
        XCTAssertEqual(levels[0], 0.05, "Silence draws as the minimum bar")
        XCTAssertEqual(levels[5], 1)
        XCTAssertEqual(levels[9], 0.05)
    }

    func testTheCroppedSegmentIsAllSound() {
        let levels = Waveform.levels(of: file, count: 10, segment: Segment(start: 0.4, length: 0.2))
        XCTAssertTrue(levels.allSatisfy { $0 > 0.9 }, "\(levels)")
    }

    func testASegmentPastTheEndStopsAtTheEnd() {
        let levels = Waveform.levels(of: file, count: 10, segment: Segment(start: 0.4, length: 5))
        XCTAssertEqual(levels.count, 10)
        XCTAssertEqual(levels[0], 1, "The segment starts on the sound")
        XCTAssertEqual(levels[9], 0.05, "and ends at the file's last, silent frame")
    }
}
