import XCTest
@testable import Pedos

/// Pitch Coverage and Auto-map in the app (`CoverageResult`, from `RecordingAnalysisKit.AutoMap`),
/// checked against the reference engine: its golden Arrangements (`fixtures/golden/`, read from
/// the repo) and its `melody_fit()` on the sample story's takes.
final class PitchCoverageTests: XCTestCase {
    private let songs = Song.prototypeCatalog
    private let fixtures = SampleFixture.prototypeLibrary

    /// Recordings of these fixtures, with the reference analysis and the ids the app gives
    /// Fixture Library Recordings.
    private func recordings(_ ids: [String]) -> [Recording] {
        ids.compactMap { id in fixtures.first { $0.id == id } }.enumerated().map { index, fixture in
            Recording(
                id: UUID(fixtureID: fixture.id), number: index + 1, seconds: fixture.seconds,
                analysis: .analyzed(fixture.analysis), audioURL: nil
            )
        }
    }

    private var all: [Recording] { recordings(fixtures.map(\.id)) }

    private func fixtureID(_ id: Recording.ID?) -> String? {
        id.map { String($0.uuidString.suffix(3)) }
    }

    /// One golden Arrangement: `fixtures/golden/arrangements/<library>/<song>.json`.
    private struct GoldenArrangement: Decodable {
        struct PerPitch: Decodable {
            let songPitch: Int
            let recording: String?
        }
        let transpose: Int
        let unlocked: Bool
        let perPitch: [PerPitch]
    }

    private func golden(_ library: String, _ song: String) throws -> GoldenArrangement {
        let url = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "fixtures/golden/arrangements/\(library)/\(song).json")
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(GoldenArrangement.self, from: Data(contentsOf: url))
    }

    func testAllNineMelodicFixturesUnlockAllTwelveSongs() {
        XCTAssertEqual(fixtures.count { $0.pitch != nil }, 9)
        XCTAssertEqual(songs.count, 12)
        XCTAssertTrue(songs.allSatisfy { CoverageResult(song: $0, recordings: all).isUnlocked })
    }

    /// The transposition and the Recording for each pitch match the reference engine's golden
    /// Arrangement for every Song, with the whole Fixture Library and with the 6-Recording
    /// `small` library, which unlocks nothing.
    func testEverySongMatchesTheGoldenArrangement() throws {
        let small = recordings(["002", "009", "016", "021", "069", "090"])
        for (library, recordings) in [("full", all), ("small", small)] {
            for song in songs {
                let want = try golden(library, song.id)
                let coverage = CoverageResult(song: song, recordings: recordings)
                XCTAssertEqual(coverage.isUnlocked, want.unlocked, "\(library)/\(song.id)")
                XCTAssertEqual(coverage.transposition, want.transpose, "\(library)/\(song.id)")
                XCTAssertEqual(want.perPitch.map(\.songPitch), song.pitches, "\(library)/\(song.id)")
                for entry in want.perPitch {
                    XCTAssertEqual(fixtureID(coverage.recordingForPitch[entry.songPitch]), entry.recording, "\(library)/\(song.id) pitch \(entry.songPitch)")
                }
                XCTAssertEqual(coverage.missing, want.perPitch.filter { $0.recording == nil }.map { $0.songPitch + want.transpose })
            }
        }
    }

    /// The reference's `melody_fit()` on each prefix of the sample story: Mary unlocks at the 6th
    /// take (the 4th Melodic Recording), and all 12 Songs by the 10th.
    func testStoryOrderUnlocksMaryAtTheSixthTake() {
        var unlockedBefore: Set<String> = []
        var unlocksByTake: [Int: [String]] = [:]
        let story = SampleFixture.prototypeStory
        for take in 1...story.count {
            let saved = recordings(Array(story.prefix(take)))
            let unlocked = songs.filter { CoverageResult(song: $0, recordings: saved).isUnlocked }.map(\.id)
            let new = unlocked.filter { !unlockedBefore.contains($0) }
            if !new.isEmpty { unlocksByTake[take] = new }
            unlockedBefore.formUnion(unlocked)
        }
        XCTAssertEqual(unlocksByTake, [
            6: ["mary"],
            7: ["jingle", "saints", "ode"],
            8: ["twinkle", "row", "amazing"],
            9: ["frere", "furelise", "auld"],
            10: ["birthday", "merryxmas"],
        ])
    }

    /// Coverage and missing notes after 3 and 8 story takes, as the reference computes them.
    func testCoverageOfLockedSongsMatchesTheReference() {
        let three = recordings(Array(SampleFixture.prototypeStory.prefix(3)))
        let mary = CoverageResult(song: songs[1], recordings: three)
        XCTAssertEqual(mary.summary, "2 of 4 notes covered")
        XCTAssertEqual(mary.transposition, -24)
        XCTAssertEqual(mary.missingNotes(), "D3 and E3")
        XCTAssertEqual(fixtureID(mary.recordingForPitch[72]), "021")
        XCTAssertEqual(fixtureID(mary.recordingForPitch[79]), "090")

        let eight = recordings(Array(SampleFixture.prototypeStory.prefix(8)))
        let birthday = CoverageResult(song: songs[3], recordings: eight)
        XCTAssertEqual(birthday.summary, "6 of 8 notes covered")
        XCTAssertEqual(birthday.transposition, -15)
        XCTAssertEqual(birthday.missingNotes(), "B2 and E3")
        XCTAssertNil(birthday.matchedArrangement)
    }

    // MARK: The rule

    /// A Melodic Recording at `pitch` that holds notes of 0.12 s and longer.
    private func melodic(_ pitch: Double, number: Int = 1) -> Recording {
        Recording(
            id: UUID(), number: number, seconds: 1,
            analysis: .analyzed(RecordingAnalysis(pitch: pitch, firstFartUsed: false, startSeconds: 0, endSeconds: 1, shortestNoteSeconds: 0.12)),
            audioURL: nil
        )
    }

    private func song(_ pitches: [Int]) -> Song {
        Song(id: "test", title: "Test", pitches: pitches, source: "", bpm: 60, beatsPerBar: 4,
             notes: pitches.enumerated().map { Song.Note(start: Double($0.offset), length: 1, pitch: $0.element) })
    }

    func testEachPitchNeedsItsOwnRecording() {
        // One Recording between two pitches can cover only one of them.
        let one = CoverageResult(song: song([60, 62]), recordings: [melodic(61)])
        XCTAssertEqual(one.covered, 1)
        XCTAssertEqual(one.total, 2)
        XCTAssertFalse(one.isUnlocked)

        let two = CoverageResult(song: song([60, 62]), recordings: [melodic(61), melodic(61.2, number: 2)])
        XCTAssertTrue(two.isUnlocked)
        XCTAssertEqual(Set(two.recordingForPitch.values).count, 2)
    }

    func testRecordingsMoveAtMostThreeSemitonesOrAnOctaveMove() {
        // 7 semitones apart, Recordings 10.5 apart: a transposition keeps both within 3.
        XCTAssertTrue(CoverageResult(song: song([60, 67]), recordings: [melodic(60), melodic(70.5, number: 2)]).isUnlocked)
        // 19 apart (12 + 7): one plays an octave from its Recording Pitch.
        let octave = CoverageResult(song: song([60, 67]), recordings: [melodic(60), melodic(79, number: 2)])
        XCTAssertTrue(octave.isUnlocked)
        // 33 apart: neither within 3 nor an octave plus 3.
        let far = CoverageResult(song: song([60, 67]), recordings: [melodic(60), melodic(100, number: 2)])
        XCTAssertEqual(far.covered, 1)
        XCTAssertEqual(far.missing.count, 1)
    }

    func testNoMelodicRecordingsCoverNothing() {
        let coverage = CoverageResult(song: songs[0], recordings: [])
        XCTAssertFalse(coverage.hasMelodicRecordings)
        XCTAssertFalse(coverage.isUnlocked)
        XCTAssertEqual(coverage.summary, "0 of 6 notes covered")
        XCTAssertNil(coverage.missingNotes())
    }

    func testCoverageIgnoresNoiseLikeAndUnanalyzedRecordings() {
        func recording(_ analysis: AnalysisState) -> Recording {
            Recording(id: UUID(), number: 1, seconds: 1, analysis: analysis, audioURL: nil)
        }
        let melodic = melodic(60)
        let recordings = [
            recording(.analyzed(RecordingAnalysis(pitch: nil, firstFartUsed: false))),
            recording(.analyzing),
            recording(.notAnalyzed),
            melodic,
        ]
        let coverage = CoverageResult(song: song([72]), recordings: recordings)
        XCTAssertTrue(coverage.isUnlocked)
        XCTAssertEqual(coverage.summary, "All 1 notes covered")
        XCTAssertEqual(coverage.recordingForPitch, [72: melodic.id])
    }

    func testCoverageChangesListUnlocksThenImprovementsClosestFirst() {
        let story = SampleFixture.prototypeStory
        // The 7th take (019) unlocks three Songs at once.
        let before = recordings(Array(story.prefix(6)))
        let after = recordings(Array(story.prefix(7)))
        let changes = CoverageChanges(songs: songs, before: before, after: after)
        XCTAssertEqual(changes.unlocked.map(\.id), ["jingle", "saints", "ode"])
        XCTAssertTrue(changes.improved.allSatisfy { !$0.coverage.isUnlocked })
        let fractions = changes.improved.map(\.coverage.fraction)
        XCTAssertEqual(fractions, fractions.sorted(by: >))
        XCTAssertNotNil(changes.closest)
        XCTAssertFalse(changes.closest!.coverage.isUnlocked)
    }

    func testPitchNames() {
        XCTAssertEqual(Pitch.name(55.83), "G♯3")
        XCTAssertEqual(Pitch.name(48.23), "C3")
        XCTAssertEqual(Pitch.name(40.03), "E2")
        XCTAssertEqual(Pitch.name(58.73), "B3")
        XCTAssertEqual(Pitch.name(60), "C4")
        XCTAssertEqual(Pitch.name(59.5), "C4", "halves round up, like the prototype")
        XCTAssertEqual(Pitch.pitchClass(55.83), 8)
        XCTAssertEqual(Pitch.pitchClass(67.43), 7)
    }
}
