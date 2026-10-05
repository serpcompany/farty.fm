import XCTest
@testable import Pedos

/// Replay plays just the fart the analysis found: no dead air before or after it.
final class ReplaySegmentTests: XCTestCase {
    private func assertSegment(_ segment: Segment?, start: Double, length: Double, line: UInt = #line) {
        guard let segment else { return XCTFail("No segment", line: line) }
        XCTAssertEqual(segment.start, start, accuracy: 1e-9, line: line)
        XCTAssertEqual(segment.length, length, accuracy: 1e-9, line: line)
    }

    private func recording(seconds: Double = 1, start: Double = 0, end: Double? = nil, analyzed: Bool = true) -> Recording {
        Recording(
            id: UUID(), number: 1, seconds: seconds,
            analysis: analyzed ? .analyzed(RecordingAnalysis(pitch: 55, firstFartUsed: false, startSeconds: start, endSeconds: end)) : .analyzing,
            audioURL: nil
        )
    }

    func testTheWholeFileWhenThereIsNothingToCut() {
        XCTAssertNil(recording(analyzed: false).replaySegment)
        XCTAssertNil(recording(start: 0, end: nil).replaySegment)
        XCTAssertNil(recording(start: 0, end: 1).replaySegment)
    }

    func testDeadAirBeforeAndAfterIsSkipped() {
        assertSegment(recording(start: 0.2, end: 0.7).replaySegment, start: 0.2, length: 0.5)
        assertSegment(recording(start: 0.2).replaySegment, start: 0.2, length: 0.8)
        assertSegment(recording(start: 0, end: 0.6).replaySegment, start: 0, length: 0.6)
    }

    func testAnEndPastTheFileStopsAtTheFile() {
        assertSegment(recording(start: 0.2, end: 1.5).replaySegment, start: 0.2, length: 0.8)
        XCTAssertNil(recording(start: 1.2).replaySegment)
    }
}
