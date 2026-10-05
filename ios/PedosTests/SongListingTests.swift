import XCTest
@testable import Pedos

/// The Compose tab's Song list, missing-note text, Auto-map's Arrangement, note timing and
/// shifts, and the coverage cache.
final class SongListingTests: XCTestCase {
    private let songs = Song.prototypeCatalog
    private let fixtures = SampleFixture.prototypeLibrary

    private func recordings(_ ids: [String]) -> [Recording] {
        ids.compactMap { id in fixtures.first { $0.id == id } }.enumerated().map { index, fixture in
            Recording(
                id: UUID(fixtureID: fixture.id), number: index + 1, seconds: fixture.seconds,
                analysis: .analyzed(fixture.analysis), audioURL: nil
            )
        }
    }

    private func listing(_ recordings: [Recording], query: String = "", order: SongOrder = .closestToUnlocking) -> SongListing {
        SongListing(songs.map { .init(song: $0, coverage: CoverageResult(song: $0, recordings: recordings)) }, matching: query, order: order)
    }

    private var all: [Recording] { recordings(fixtures.map(\.id)) }

    /// The first 8 story takes (6 Melodic): 7 Unlocked Songs and 5 locked ones.
    private var eight: [Recording] { recordings(Array(SampleFixture.prototypeStory.prefix(8))) }

    // MARK: Song notes

    func testEverySongsNotesPlayExactlyItsPitches() {
        for song in songs {
            XCTAssertFalse(song.notes.isEmpty, song.id)
            XCTAssertEqual(Set(song.notes.map(\.pitch)).sorted(), song.pitches, song.id)
            XCTAssertEqual(song.notes.map(\.start), song.notes.map(\.start).sorted(), "\(song.id) notes aren't in time order")
            XCTAssertTrue(song.notes.allSatisfy { $0.length > 0 }, song.id)
            XCTAssertTrue([3, 4, 6].contains(song.beatsPerBar), song.id)
        }
        let twinkle = songs[0]
        XCTAssertEqual(twinkle.notes.count, 28)
        XCTAssertEqual(twinkle.beats, 32)
        XCTAssertEqual(twinkle.notes.prefix(4).map(\.pitch), [69, 69, 76, 76], "Twinkle starts on the tonic, then up a fifth")
    }

    func testANotesSegmentComesFromItsBeatsAndTheTempo() {
        let mary = songs[1]
        XCTAssertEqual(mary.bpm, 84)
        let last = mary.seconds(of: mary.notes[25])
        XCTAssertEqual(last.start, 14 * 60 / 84, accuracy: 1e-9, "beat 14")
        XCTAssertEqual(last.length, 2 * 60 / 84, accuracy: 1e-9, "2 beats")
        let jingle = songs[2]
        let triplet = jingle.seconds(of: jingle.notes[9])
        XCTAssertEqual(triplet.start, jingle.notes[9].start * 0.5, accuracy: 1e-9, "at 120 bpm a beat is 0.5 s")
        XCTAssertEqual(triplet.length, jingle.notes[9].length * 0.5, accuracy: 1e-9)
    }

    func testShiftsRoundToATenthOfASemitone() {
        XCTAssertEqual(Arrangement.semitones(1.17), "+1.2 semitones")
        XCTAssertEqual(Arrangement.semitones(-2.83), "−2.8 semitones")
        XCTAssertEqual(Arrangement.semitones(-0.04), "0.0 semitones")
        XCTAssertEqual(Arrangement.semitones(3), "+3.0 semitones")
    }

    // MARK: Listing

    func testClosestToUnlockingPutsUnlockedSongsFirstThenTheHighestCoverage() {
        let listing = listing(eight)
        XCTAssertEqual(listing.unlocked.map(\.song.id), ["mary", "jingle", "saints", "ode", "twinkle", "row", "amazing"], "fewest notes first")
        XCTAssertEqual(listing.locked.map(\.song.id), ["frere", "furelise", "auld", "birthday", "merryxmas"])
        XCTAssertTrue(listing.unlocked.allSatisfy(\.coverage.isUnlocked))
        XCTAssertFalse(listing.locked.contains { $0.coverage.isUnlocked })
    }

    func testAlphabeticalSortsWithinEachSection() {
        let listing = listing(eight, order: .alphabetical)
        XCTAssertEqual(listing.unlocked.map(\.song.title), [
            "Amazing Grace", "Jingle Bells", "Mary Had a Little Lamb", "Ode to Joy", "Row, Row, Row Your Boat",
            "Twinkle, Twinkle, Little Star", "When the Saints Go Marching In",
        ])
        XCTAssertEqual(listing.locked.map(\.song.title), [
            "Auld Lang Syne", "Frère Jacques", "Für Elise", "Happy Birthday", "We Wish You a Merry Christmas",
        ])
    }

    func testSearchMatchesAnywhereInTheTitleIgnoringCaseAndAccents() {
        XCTAssertEqual(listing(eight, query: "JINGLE").unlocked.map(\.song.id), ["jingle"])
        XCTAssertEqual(listing(eight, query: "fur").locked.map(\.song.id), ["furelise"])
        XCTAssertEqual(listing(eight, query: "frere").locked.map(\.song.id), ["frere"])
        XCTAssertEqual(listing(eight, query: "little").unlocked.map(\.song.id), ["mary", "twinkle"])
        XCTAssertEqual(listing(eight, query: "  ").unlocked.count, 7, "a blank search matches every Song")
        XCTAssertTrue(listing(eight, query: "zzz").isEmpty)
    }

    func testEverySongUnlocksWithTheWholeFixtureLibrary() {
        let listing = listing(all)
        XCTAssertEqual(listing.unlocked.count, 12)
        XCTAssertTrue(listing.locked.isEmpty)
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
            return Song(
                id: "\(song.id)-\(index)", title: "\(song.title) \(index)", pitches: song.pitches, source: song.source,
                bpm: song.bpm, beatsPerBar: song.beatsPerBar, notes: song.notes
            )
        }
        let recordings = eight
        var cache = CoverageCache(songs: catalog)
        let listing = cache.listing(recordings: recordings, matching: "", order: .closestToUnlocking)
        XCTAssertEqual(listing.unlocked.count + listing.locked.count, 500)
        XCTAssertEqual(listing.unlocked.count, 293, "41 rounds of 7 Unlocked Songs, then 6 of the next 8 Songs")
        // A search keystroke filters the stored, sorted results.
        measure {
            _ = cache.listing(recordings: recordings, matching: "star", order: .closestToUnlocking)
            _ = cache.listing(recordings: recordings, matching: "sta", order: .alphabetical)
        }
        XCTAssertEqual(cache.catalogMatches, 1, "searching matched the Song Catalog again")
    }

    // MARK: Missing notes

    func testMissingNotesNameEachNoteWithItsOctave() {
        let coverage = { (id: String, recordings: [Recording]) in
            CoverageResult(song: self.songs.first { $0.id == id }!, recordings: recordings)
        }
        XCTAssertEqual(coverage("birthday", eight).missingNotes(), "B2 and E3")
        XCTAssertEqual(coverage("frere", eight).missingNotes(), "D♯3")
        XCTAssertNil(coverage("mary", eight).missingNotes(), "nothing is missing from an Unlocked Song")

        // Two Melodic Recordings: Happy Birthday still needs 6 notes.
        let few = recordings(Array(SampleFixture.prototypeStory.prefix(3)))
        XCTAssertEqual(coverage("birthday", few).missingNotes(), "A♯2, D3, D♯3, F3, G♯3, and A♯3")
        XCTAssertEqual(coverage("birthday", few).missingNotes(limit: 3), "A♯2, D3, D♯3, and 3 more")
        XCTAssertEqual(coverage("mary", few).missingNotes(limit: 3), "D3 and E3", "no \"more\" within the limit")
    }

    // MARK: Auto-map's Arrangement

    func testAutoMapGivesEachPitchItsOwnRecordingWithinThreeSemitonesOrAnOctaveMove() throws {
        for recordings in [eight, all] {
            for song in songs {
                let coverage = CoverageResult(song: song, recordings: recordings)
                guard coverage.isUnlocked else {
                    XCTAssertNil(coverage.matchedArrangement, "\(song.id) is locked, so it has no Arrangement")
                    continue
                }
                let arrangement = try XCTUnwrap(coverage.matchedArrangement, song.id)
                XCTAssertEqual(arrangement.recordingForPitch.keys.sorted(), song.pitches, song.id)
                XCTAssertEqual(Set(arrangement.recordings).count, song.pitches.count, "\(song.id): one different Recording per pitch")
                XCTAssertTrue(song.notes.allSatisfy { arrangement.recording(playing: $0) != nil }, "\(song.id): a note has no Recording")

                // Every Recording is within 3 semitones of the pitch it plays, or of the same
                // note an octave away.
                for pitch in song.pitches {
                    let recording = try XCTUnwrap(recordings.first { $0.id == arrangement.recordingForPitch[pitch] })
                    let shift = abs(Double(arrangement.soundingPitch(pitch)) - recording.pitch!)
                    XCTAssertTrue(shift <= 3 || abs(shift - 12) <= 3, "\(song.id): shift \(shift)")
                }
            }
        }
    }

    func testMarysArrangementIsFourFixturesLowestPitchFirst() throws {
        let arrangement = try XCTUnwrap(CoverageResult(song: songs[1], recordings: all).matchedArrangement)
        // Mary's pitches, lowest first, are played by 090 (G3), 084, 086 (both G♯3) and 094 (B3),
        // moved by −19 semitones: the reference's golden Arrangement.
        XCTAssertEqual(arrangement.recordings.map { String($0.uuidString.suffix(3)) }, ["090", "084", "086", "094"])
        XCTAssertEqual(arrangement.transposition, -19)
    }

    // MARK: Coverage cache

    func testCoverageCacheMatchesOncePerChangeToTheMelodicRecordings() {
        var cache = CoverageCache(songs: songs)
        let story = recordings(SampleFixture.prototypeStory)
        for query in ["", "m", "ma", "mar", "mary", "ode"] {
            _ = cache.listing(recordings: Array(story.prefix(5)), matching: query, order: .closestToUnlocking)
        }
        _ = cache.listing(recordings: Array(story.prefix(5)), matching: "", order: .alphabetical)
        _ = cache.coverage(of: songs[1], recordings: Array(story.prefix(5)))
        XCTAssertEqual(cache.catalogMatches, 1, "searching, sorting and looking up matched the catalog again")

        // A Noise-like Recording changes nothing; a Melodic one matches the catalog once more.
        _ = cache.listing(recordings: Array(story.prefix(5)) + recordings(["002"]), matching: "", order: .closestToUnlocking)
        XCTAssertEqual(cache.catalogMatches, 1)
        let listing = cache.listing(recordings: Array(story.prefix(6)), matching: "", order: .closestToUnlocking)
        XCTAssertEqual(cache.catalogMatches, 2)
        XCTAssertEqual(listing.unlocked.map(\.song.id), ["mary"], "the 6th take unlocks Mary")
    }

    func testCoverageCacheRecomputesWhenTheMelodicRecordingsChange() {
        var cache = CoverageCache(songs: songs)
        let mary = songs[1]
        let story = recordings(SampleFixture.prototypeStory)
        let beforeMary = Array(story.prefix(5))
        XCTAssertFalse(cache.coverage(of: mary, recordings: beforeMary).isUnlocked)
        XCTAssertTrue(cache.coverage(of: mary, recordings: Array(story.prefix(6))).isUnlocked, "the 6th take unlocks Mary")

        // Noise-like Recordings don't change Pitch Coverage.
        let noise = recordings(["002"])
        XCTAssertEqual(cache.coverage(of: mary, recordings: beforeMary + noise), CoverageResult(song: mary, recordings: beforeMary))
        XCTAssertEqual(cache.coverage(of: mary, recordings: []).covered, 0)
    }
}
