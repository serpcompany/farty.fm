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

        // The start time, for a playhead, is set once the audio actually starts.
        for _ in 0..<50 where player.startedAt == nil {
            try await Task.sleep(for: .milliseconds(20))
        }
        let startedAt = try XCTUnwrap(player.startedAt, "Playback never started")
        XCTAssertLessThan(abs(startedAt.timeIntervalSinceNow), 1)

        let played = try await waitUntilStopped(player, within: .seconds(6))
        XCTAssertNil(player.nowPlaying, "Playback never ended")
        XCTAssertNil(player.startedAt)
        XCTAssertGreaterThan(played, .seconds(1.5), "Playback ended before the take did, so it didn't play")
    }

    func testASegmentPlaysForItsLengthThenStops() async throws {
        // Mary's 7th note: 0.71 s from 2.1 s into its 12.5 s render, so the file itself would
        // play on for another 10 s.
        let mary = try XCTUnwrap(Song.prototypeCatalog.first { $0.id == "mary" })
        let (start, length) = mary.seconds(of: mary.notes[6])
        XCTAssertEqual(length, 60 / 84, accuracy: 1e-9)
        let player = AudioPlayer()
        let item = PlaybackItem.note(UUID(), index: 6)
        player.play(item, url: try XCTUnwrap(mary.prototypeAudioURL), segment: Segment(start: start, length: length))
        XCTAssertEqual(player.nowPlaying, item)

        // Time it from when the audio actually started: activating the audio session first can
        // take a while on a slow machine.
        for _ in 0..<250 where player.startedAt == nil {
            try await Task.sleep(for: .milliseconds(20))
        }
        let startedAt = try XCTUnwrap(player.startedAt, "The segment never started")
        _ = try await waitUntilStopped(player, within: .seconds(8))
        let played = Date.now.timeIntervalSince(startedAt)
        XCTAssertNil(player.nowPlaying, "The segment never ended")
        XCTAssertGreaterThan(played, length - 0.1, "It ended before the note did")
        XCTAssertLessThan(played, length + 1.5, "It played on past the note")
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
