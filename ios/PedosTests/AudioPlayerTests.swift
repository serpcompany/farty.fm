import XCTest
@testable import Pedos

/// Playback of the Debug fixture audio, which UI tests can't catch reliably: a take plays for
/// 2 s at most.
@MainActor
final class AudioPlayerTests: XCTestCase {
    /// Fixture 080 is the longest take, 1.98 s.
    private let longestTake = SampleFixture.prototypeLibrary.first { $0.id == "080" }!

    private func waitUntilStopped(_ player: AudioPlayer, within limit: Duration) async throws -> Duration {
        let clock = ContinuousClock()
        let start = clock.now
        while player.nowPlaying != nil, start.duration(to: clock.now) < limit {
            try await Task.sleep(for: .milliseconds(20))
        }
        return start.duration(to: clock.now)
    }

    func testPlaysATakeToTheEnd() async throws {
        let player = AudioPlayer()
        let item = PlaybackItem.recording(UUID())
        player.play(item, url: try XCTUnwrap(longestTake.audioURL))
        XCTAssertEqual(player.nowPlaying, item)

        let played = try await waitUntilStopped(player, within: .seconds(6))
        XCTAssertNil(player.nowPlaying, "Playback never ended")
        XCTAssertGreaterThan(played, .seconds(1.5), "Playback ended before the take did, so it didn't play")
    }

    func testTogglingThePlayingItemStopsIt() async throws {
        let player = AudioPlayer()
        let item = PlaybackItem.draft(UUID())
        let url = try XCTUnwrap(longestTake.audioURL)
        player.toggle(item, url: url)
        XCTAssertEqual(player.nowPlaying, item)
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(player.nowPlaying, item, "Playback stopped early")

        player.toggle(item, url: url)
        XCTAssertNil(player.nowPlaying)
        // A stopped take doesn't come back when its finish time passes.
        try await Task.sleep(for: .seconds(2))
        XCTAssertNil(player.nowPlaying)
    }

    func testPlayingAnotherItemReplacesTheFirst() async throws {
        let player = AudioPlayer()
        let first = PlaybackItem.recording(UUID())
        let second = PlaybackItem.recording(UUID())
        let url = try XCTUnwrap(longestTake.audioURL)
        player.play(first, url: url)
        player.play(second, url: url)
        XCTAssertEqual(player.nowPlaying, second)
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(player.nowPlaying, second)
    }

    func testNothingPlaysWithoutAudio() {
        let player = AudioPlayer()
        player.play(.recording(UUID()), url: nil)
        XCTAssertNil(player.nowPlaying)
    }
}
