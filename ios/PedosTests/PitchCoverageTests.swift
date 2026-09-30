import XCTest
@testable import Pedos

/// The approved Pitch Coverage rule, checked against the numbers the #47 prototype shows.
final class PitchCoverageTests: XCTestCase {
    private let songs = Song.prototypeCatalog
    private let fixtures = SampleFixture.prototypeLibrary

    private func pitches(_ ids: [String]) -> [Double] {
        ids.compactMap { id in fixtures.first { $0.id == id }?.pitch }
    }

    func testAllNineMelodicFixturesUnlockSixOfTwelveSongs() {
        let melodic = fixtures.compactMap(\.pitch)
        XCTAssertEqual(melodic.count, 9)
        XCTAssertEqual(songs.count, 12)

        let unlocked = songs.filter {
            let match = PitchCoverage.match(songPitches: $0.pitches, recordingPitches: melodic)
            return match.covered == match.total
        }
        XCTAssertEqual(unlocked.map(\.id), ["twinkle", "mary", "jingle", "saints", "row", "ode"])
    }

    /// Covered pitches, transposition and missing pitches for every Song, as the prototype's
    /// `fit()` computes them with all 23 fixtures.
    func testEverySongMatchesThePrototypeWithAllFixtures() {
        let melodic = fixtures.compactMap(\.pitch)
        let expected: [String: (covered: Int, total: Int, transposition: Int, missing: [Int])] = [
            "twinkle": (6, 6, -18, []),
            "mary": (4, 4, -21, []),
            "jingle": (5, 5, -9, []),
            "birthday": (6, 8, -14, [50, 52]),
            "frere": (6, 7, -6, [51]),
            "saints": (5, 5, -9, []),
            "row": (6, 6, -14, []),
            "ode": (5, 5, -16, []),
            "merryxmas": (6, 8, -14, [50, 52]),
            "amazing": (5, 6, -14, [50]),
            "furelise": (6, 7, -18, [51]),
            "auld": (6, 7, -9, [63]),
        ]
        for song in songs {
            let match = PitchCoverage.match(songPitches: song.pitches, recordingPitches: melodic)
            let want = try! XCTUnwrap(expected[song.id])
            XCTAssertEqual(match.covered, want.covered, song.id)
            XCTAssertEqual(match.total, want.total, song.id)
            XCTAssertEqual(match.transposition, want.transposition, song.id)
            XCTAssertEqual(match.missing, want.missing, song.id)
        }
        // Mary is played by 013, 021, 090 and 094, one per pitch.
        let mary = PitchCoverage.match(songPitches: songs[1].pitches, recordingPitches: melodic)
        let melodicIDs = fixtures.filter { $0.pitch != nil }.map(\.id)
        XCTAssertEqual(mary.used.map { melodicIDs[$0] }, ["013", "021", "090", "094"])
    }

    func testStoryOrderUnlocksMaryAtTheSixthMelodicRecording() {
        var saved: [String] = []
        var unlockedBefore: Set<String> = []
        var firstUnlock: (melodicCount: Int, songs: [String])?
        var unlocksByMelodicCount: [Int: [String]] = [:]

        for id in SampleFixture.prototypeStory {
            saved.append(id)
            let melodic = pitches(saved)
            let unlocked = songs.filter {
                let match = PitchCoverage.match(songPitches: $0.pitches, recordingPitches: melodic)
                return match.covered == match.total
            }.map(\.id)
            let new = unlocked.filter { !unlockedBefore.contains($0) }
            if !new.isEmpty {
                unlocksByMelodicCount[melodic.count] = new
                if firstUnlock == nil { firstUnlock = (melodic.count, new) }
            }
            unlockedBefore.formUnion(unlocked)
        }

        XCTAssertEqual(firstUnlock?.melodicCount, 6)
        XCTAssertEqual(firstUnlock?.songs, ["mary"])
        XCTAssertEqual(unlocksByMelodicCount, [6: ["mary"], 8: ["jingle", "saints", "ode"], 9: ["twinkle", "row"]])
    }

    func testEachPitchNeedsItsOwnRecording() {
        // One Recording between two pitches can cover only one of them.
        let match = PitchCoverage.match(songPitches: [60, 62], recordingPitches: [61])
        XCTAssertEqual(match.covered, 1)
        XCTAssertEqual(match.total, 2)
        XCTAssertEqual(match.transposition, -4)
        XCTAssertEqual(match.missing, [56])

        let two = PitchCoverage.match(songPitches: [60, 62], recordingPitches: [61, 61.2])
        XCTAssertEqual(two.covered, 2)
        XCTAssertEqual(two.used, [0, 1])
    }

    func testRecordingsMayBeShiftedAtMostThreeSemitones() {
        // Pitches 7 semitones apart; Recordings 10.5 apart: some transposition keeps both within 3.
        XCTAssertEqual(PitchCoverage.match(songPitches: [60, 67], recordingPitches: [60, 70.5]).covered, 2)
        // 14 apart: no transposition brings both within 3.
        let far = PitchCoverage.match(songPitches: [60, 67], recordingPitches: [60, 74])
        XCTAssertEqual(far.covered, 1)
        XCTAssertEqual(far.transposition, -10, "the lowest transposition that covers the most wins")
        XCTAssertEqual(far.missing, [50])
    }

    func testNoMelodicRecordingsCoverNothing() {
        let match = PitchCoverage.match(songPitches: [60, 62, 64], recordingPitches: [])
        XCTAssertEqual(match.covered, 0)
        XCTAssertEqual(match.total, 3)
        XCTAssertEqual(match.missing, [])

        let coverage = CoverageResult(song: songs[0], recordings: [])
        XCTAssertFalse(coverage.hasMelodicRecordings)
        XCTAssertFalse(coverage.isUnlocked)
        XCTAssertEqual(coverage.summary, "0 of 6 notes covered")
    }

    func testCoverageIgnoresNoiseLikeAndUnanalyzedRecordings() {
        func recording(_ analysis: AnalysisState) -> Recording {
            Recording(id: UUID(), number: 1, seconds: 1, analysis: analysis, audioURL: nil)
        }
        let melodic = recording(.analyzed(RecordingAnalysis(pitch: 60, firstFartUsed: false)))
        let recordings = [
            recording(.analyzed(RecordingAnalysis(pitch: nil, firstFartUsed: false))),
            recording(.analyzing),
            recording(.notAnalyzed),
            melodic,
        ]
        let song = Song(id: "one", title: "One note", pitches: [72], source: "", bpm: 100, notes: [])
        let coverage = CoverageResult(song: song, recordings: recordings)
        XCTAssertTrue(coverage.isUnlocked)
        XCTAssertEqual(coverage.summary, "All 1 notes covered")
        XCTAssertEqual(coverage.used, [melodic.id])
    }

    func testCoverageChangesListUnlocksThenImprovementsClosestFirst() {
        func recordings(_ ids: [String]) -> [Recording] {
            ids.compactMap { id in fixtures.first { $0.id == id } }.enumerated().map { index, fixture in
                Recording(id: UUID(), number: index + 1, seconds: fixture.seconds, analysis: .analyzed(fixture.analysis), audioURL: nil)
            }
        }
        let story = SampleFixture.prototypeStory
        // The 10th take (084) unlocks three Songs at once.
        let before = recordings(Array(story.prefix(9)))
        let after = before + recordings([story[9]])
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
