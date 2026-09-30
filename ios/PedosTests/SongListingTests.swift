import XCTest
@testable import Pedos

/// The Compose tab's Song list, missing-note text, Auto-map's Arrangement and the coverage cache.
final class SongListingTests: XCTestCase {
    private let songs = Song.prototypeCatalog
    private let fixtures = SampleFixture.prototypeLibrary

    private func recordings(_ ids: [String]) -> [Recording] {
        ids.compactMap { id in fixtures.first { $0.id == id } }.enumerated().map { index, fixture in
            Recording(id: UUID(), number: index + 1, seconds: fixture.seconds, analysis: .analyzed(fixture.analysis), audioURL: nil)
        }
    }

    private func listing(_ recordings: [Recording], query: String = "", order: SongOrder = .closestToUnlocking) -> SongListing {
        SongListing(songs.map { .init(song: $0, coverage: CoverageResult(song: $0, recordings: recordings)) }, matching: query, order: order)
    }

    private var all: [Recording] { recordings(fixtures.map(\.id)) }

    // MARK: Song notes

    func testEverySongsNotesPlayExactlyItsPitches() {
        for song in songs {
            XCTAssertFalse(song.notes.isEmpty, song.id)
            XCTAssertEqual(Set(song.notes.map(\.pitch)).sorted(), song.pitches, song.id)
            XCTAssertEqual(song.notes.map(\.start), song.notes.map(\.start).sorted(), "\(song.id) notes aren't in time order")
            XCTAssertTrue(song.notes.allSatisfy { $0.length > 0 }, song.id)
        }
        let twinkle = songs[0]
        XCTAssertEqual(twinkle.notes.count, 28)
        XCTAssertEqual(twinkle.beats, 32)
        XCTAssertEqual(twinkle.notes.prefix(4).map(\.pitch), [69, 69, 76, 76], "Twinkle starts on the tonic, then up a fifth")
    }

    // MARK: Listing

    func testClosestToUnlockingPutsUnlockedSongsFirstThenTheHighestCoverage() {
        let listing = listing(all)
        XCTAssertEqual(listing.unlocked.map(\.song.id), ["mary", "jingle", "saints", "ode", "twinkle", "row"], "fewest notes first")
        XCTAssertEqual(listing.locked.map(\.song.id), ["frere", "furelise", "auld", "amazing", "birthday", "merryxmas"])
        XCTAssertTrue(listing.unlocked.allSatisfy(\.coverage.isUnlocked))
        XCTAssertFalse(listing.locked.contains { $0.coverage.isUnlocked })
    }

    func testAlphabeticalSortsWithinEachSection() {
        let listing = listing(all, order: .alphabetical)
        XCTAssertEqual(listing.unlocked.map(\.song.title), [
            "Jingle Bells", "Mary Had a Little Lamb", "Ode to Joy", "Row, Row, Row Your Boat",
            "Twinkle, Twinkle, Little Star", "When the Saints Go Marching In",
        ])
        XCTAssertEqual(listing.locked.map(\.song.title), [
            "Amazing Grace", "Auld Lang Syne", "Frère Jacques", "Für Elise", "Happy Birthday", "We Wish You a Merry Christmas",
        ])
    }

    func testSearchMatchesAnywhereInTheTitleIgnoringCaseAndAccents() {
        XCTAssertEqual(listing(all, query: "JINGLE").unlocked.map(\.song.id), ["jingle"])
        XCTAssertEqual(listing(all, query: "fur").locked.map(\.song.id), ["furelise"])
        XCTAssertEqual(listing(all, query: "frere").locked.map(\.song.id), ["frere"])
        XCTAssertEqual(listing(all, query: "little").unlocked.map(\.song.id), ["mary", "twinkle"])
        XCTAssertEqual(listing(all, query: "  ").unlocked.count, 6, "a blank search matches every Song")
        XCTAssertTrue(listing(all, query: "zzz").isEmpty)
    }

    func testWithoutMelodicRecordingsEverySongIsLockedFewestNotesFirst() {
        let listing = listing(recordings(["069"]))
        XCTAssertTrue(listing.unlocked.isEmpty)
        XCTAssertEqual(listing.locked.count, 12)
        XCTAssertEqual(listing.locked.first?.song.id, "mary")
        XCTAssertTrue(listing.locked.allSatisfy { !$0.coverage.hasMelodicRecordings && $0.coverage.missingNotes() == nil })
    }

    func testTheListScalesToHundredsOfSongs() {
        let catalog = (0..<500).map { index in
            let song = songs[index % songs.count]
            return Song(id: "\(song.id)-\(index)", title: "\(song.title) \(index)", pitches: song.pitches, source: song.source, bpm: song.bpm, notes: song.notes)
        }
        let recordings = all
        var cache = CoverageCache()
        let rows = catalog.map { SongListing.Row(song: $0, coverage: cache.coverage(of: $0, recordings: recordings)) }
        let listing = SongListing(rows, matching: "", order: .closestToUnlocking)
        XCTAssertEqual(listing.unlocked.count + listing.locked.count, 500)
        XCTAssertEqual(listing.unlocked.count, 252, "41 rounds of 6 Unlocked Songs, then 6 of the next 8 Songs")
        // Once the coverage is known, sorting and searching hundreds of Songs is cheap.
        measure {
            _ = SongListing(rows, matching: "star", order: .alphabetical)
            _ = SongListing(rows, matching: "", order: .closestToUnlocking)
        }
    }

    // MARK: Missing notes

    func testMissingNotesNameEachNoteWithItsOctave() {
        let coverage = { (id: String, recordings: [Recording]) in
            CoverageResult(song: self.songs.first { $0.id == id }!, recordings: recordings)
        }
        XCTAssertEqual(coverage("birthday", all).missingNotes(), "D3 and E3")
        XCTAssertEqual(coverage("frere", all).missingNotes(), "D♯3")
        XCTAssertNil(coverage("mary", all).missingNotes(), "nothing is missing from an Unlocked Song")

        // Two Melodic Recordings: Happy Birthday still needs 6 notes.
        let few = recordings(Array(SampleFixture.prototypeStory.prefix(3)))
        XCTAssertEqual(coverage("birthday", few).missingNotes(), "F2, G2, A2, C3, D3, and D♯3")
        XCTAssertEqual(coverage("birthday", few).missingNotes(limit: 3), "F2, G2, A2, and 3 more")
        XCTAssertEqual(coverage("mary", few).missingNotes(limit: 3), "C3 and D3", "no \"more\" within the limit")
    }

    // MARK: Arrangement

    func testAutoMapGivesEachPitchItsOwnRecordingWithinThreeSemitones() throws {
        let recordings = all
        for song in songs {
            let coverage = CoverageResult(song: song, recordings: recordings)
            guard coverage.isUnlocked else {
                XCTAssertNil(coverage.arrangement, "\(song.id) is locked, so it has no Arrangement")
                continue
            }
            let arrangement = try XCTUnwrap(coverage.arrangement, song.id)
            XCTAssertEqual(arrangement.recordingForPitch.keys.sorted(), song.pitches, song.id)
            XCTAssertEqual(Set(arrangement.recordings).count, song.pitches.count, "\(song.id): one different Recording per pitch")
            XCTAssertEqual(Set(arrangement.recordings), Set(coverage.used), song.id)
            XCTAssertTrue(song.notes.allSatisfy { arrangement.recording(playing: $0) != nil }, "\(song.id): a note has no Recording")

            // Under one transposition, every Recording is within 3 semitones of the pitch it plays.
            let match = PitchCoverage.match(songPitches: song.pitches, recordingPitches: recordings.compactMap(\.pitch))
            for pitch in song.pitches {
                let recording = try XCTUnwrap(recordings.first { $0.id == arrangement.recordingForPitch[pitch] })
                XCTAssertLessThanOrEqual(abs(Double(pitch + match.transposition) - recording.pitch!), PitchCoverage.maximumShift, song.id)
            }
        }
    }

    func testMarysArrangementIsPlayedByFourFixturesLowestPitchFirst() throws {
        let recordings = all
        let mary = songs[1]
        let arrangement = try XCTUnwrap(CoverageResult(song: mary, recordings: recordings).arrangement)
        let fixtureOf = { (id: Recording.ID) in self.fixtures[recordings.firstIndex { $0.id == id }!].id }
        // Mary's pitches, lowest first, are played by 021 (C3), 013 (G♯3), 090 (G3) and 094 (B3).
        XCTAssertEqual(arrangement.recordings.map(fixtureOf), ["021", "013", "090", "094"])
    }

    // MARK: Coverage cache

    func testCoverageCacheRecomputesWhenTheMelodicRecordingsChange() {
        var cache = CoverageCache()
        let mary = songs[1]
        let story = recordings(SampleFixture.prototypeStory)
        let beforeMary = Array(story.prefix(7))
        XCTAssertFalse(cache.coverage(of: mary, recordings: beforeMary).isUnlocked)
        XCTAssertTrue(cache.coverage(of: mary, recordings: Array(story.prefix(8))).isUnlocked, "the 8th take unlocks Mary")

        // Noise-like Recordings don't change Pitch Coverage.
        let noise = recordings(["002"])
        XCTAssertEqual(cache.coverage(of: mary, recordings: beforeMary + noise), CoverageResult(song: mary, recordings: beforeMary))
        XCTAssertEqual(cache.coverage(of: mary, recordings: []).covered, 0)
    }
}
