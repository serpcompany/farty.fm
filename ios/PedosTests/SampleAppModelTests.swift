import AVFAudio
import XCTest
@testable import Pedos

@MainActor
final class SampleAppModelTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName = ""
    private var clock = Date(timeIntervalSinceReferenceDate: 0)

    override func setUp() async throws {
        suiteName = "PedosTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        clock = Date(timeIntervalSinceReferenceDate: 0)
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private func makeModel(
        start: [String] = [],
        toots: [Song.ID] = [],
        microphone: MicrophoneAccess = SimulatedMicrophone(permission: .granted),
        failures: SampleAppModel.Failures = [],
        fixtures: [SampleFixture] = SampleFixture.prototypeLibrary,
        story: [String] = SampleFixture.prototypeStory,
        songAudio: @escaping (Song) -> URL? = \.prototypeAudioURL,
        renders: [Song.ID: StandInRender] = Song.prototypeRenders
    ) -> SampleAppModel {
        SampleAppModel(
            fixtures: fixtures,
            story: story,
            songs: Song.prototypeCatalog,
            initialFixtureIDs: start,
            initialTootSongIDs: toots,
            songAudio: songAudio,
            renders: renders,
            microphone: microphone,
            defaults: defaults,
            failures: failures,
            now: { [unowned self] in clock },
            analysisDelay: .zero,
            interruptionDelay: .zero,
            makingDelay: .zero
        )
    }

    private var allFixtureIDs: [String] { SampleFixture.prototypeLibrary.map(\.id) }

    private func song(_ id: Song.ID) -> Song { Song.prototypeCatalog.first { $0.id == id }! }

    /// Records for one second and stops, returning the draft under Review.
    @discardableResult
    private func recordTake(_ model: SampleAppModel, seconds: TimeInterval = 1) async -> Draft? {
        await model.startRecording()
        clock += seconds
        await model.stopRecording()
        if case .review(let draft) = model.flow { return draft }
        return nil
    }

    /// The Fixture Library id a take under Review stands in for.
    private func fixtureID(_ model: SampleAppModel, _ draft: Draft?) -> String? {
        draft.flatMap { model.fixtureID(ofDraft: $0.id) }
    }

    private func result(_ model: SampleAppModel) -> RecordResult? {
        if case .result(let result) = model.flow { result } else { nil }
    }

    // MARK: First launch

    func testWelcomeShowsOnFirstLaunchOnly() {
        let first = makeModel()
        XCTAssertTrue(first.isShowingWelcome)
        first.skipWelcome()
        XCTAssertFalse(first.isShowingWelcome)
        XCTAssertFalse(makeModel().isShowingWelcome, "Welcome came back on the second launch")
    }

    func testAllowMicrophoneAsksForPermissionAndClosesWelcome() async {
        let microphone = SimulatedMicrophone(permission: .undetermined)
        let model = makeModel(microphone: microphone)
        await model.allowMicrophoneFromWelcome()
        XCTAssertFalse(model.isShowingWelcome)
        XCTAssertEqual(microphone.permission, .granted)
    }

    func testMicrophoneOffWhenPermissionIsDenied() async {
        let model = makeModel(microphone: SimulatedMicrophone(permission: .denied))
        await model.startRecording()
        XCTAssertEqual(model.capture, .idle)
        XCTAssertEqual(model.recordProblem, .microphoneOff)
        model.dismissRecordProblem()
        XCTAssertNil(model.recordProblem)
    }

    func testRecordAsksForTheMicrophoneFirst() async {
        let allowing = makeModel(microphone: SimulatedMicrophone(permission: .undetermined, allows: true))
        await allowing.startRecording()
        XCTAssertTrue(allowing.isRecording)

        let refusing = makeModel(microphone: SimulatedMicrophone(permission: .undetermined, allows: false))
        await refusing.startRecording()
        XCTAssertEqual(refusing.capture, .idle)
        XCTAssertNil(refusing.recordProblem, "saying no to the system prompt isn't an error")
    }

    // MARK: Recording

    func testTakesFollowTheStoryThenTheRestOfTheLibrary() async {
        let model = makeModel()
        var taken: [String] = []
        for _ in SampleFixture.prototypeLibrary {
            let draft = await recordTake(model)
            taken.append(fixtureID(model, draft) ?? "none")
            await model.saveDraft()
            model.finishFlow()
        }
        XCTAssertEqual(Array(taken.prefix(12)), SampleFixture.prototypeStory)
        XCTAssertEqual(Array(taken.dropFirst(12)), ["009", "016", "018", "022", "032", "055", "065", "067", "080", "081", "091"])
        XCTAssertEqual(model.recordings.map(\.number), Array(1...23))
        XCTAssertEqual(model.melodicRecordings.count, 9)
        XCTAssertEqual(model.collectedPitchClasses.count, 6)

        // With every fixture saved, takes repeat the story.
        let again = await recordTake(model)
        XCTAssertEqual(fixtureID(model, again), SampleFixture.prototypeStory[23 % 12])
    }

    func testStartingPointsContinueTheStory() async {
        let model = makeModel(start: Array(SampleFixture.prototypeStory.prefix(3)))
        XCTAssertEqual(model.recordings.map(\.name), ["Recording 1", "Recording 2", "Recording 3"])
        XCTAssertEqual(model.melodicRecordings.count, 2)
        let draft = await recordTake(model)
        XCTAssertEqual(fixtureID(model, draft), "052")
    }

    func testRecordingShowsTheTakeInReview() async {
        let model = makeModel()
        await model.startRecording()
        XCTAssertEqual(model.capture, .recording(startedAt: clock))
        clock += 2
        await model.stopRecording()
        guard case .review(let draft) = model.flow else { return XCTFail("no Review: \(String(describing: model.flow))") }
        XCTAssertEqual(model.fixtureID(ofDraft: draft.id), "069")
        XCTAssertEqual(model.simulatedSource(ofDraft: draft.id), "Fixture Library Recording 069")
        XCTAssertEqual(draft.seconds, 1.08)
        XCTAssertNotNil(draft.audioURL)
        XCTAssertEqual(draft.waveform.count, 40)
        XCTAssertEqual(draft.waveform.max(), 1)
        XCTAssertEqual(model.capture, .idle)
        XCTAssertTrue(model.recordings.isEmpty, "nothing is saved until Save")
    }

    func testTooShortTakeIsNothingHeard() async {
        let model = makeModel()
        await recordTake(model, seconds: 0.2)
        XCTAssertNil(model.flow)
        XCTAssertEqual(model.recordProblem, .nothingHeard)
        XCTAssertTrue(model.recordings.isEmpty)

        let draft = await recordTake(model)
        XCTAssertNil(model.recordProblem, "starting again clears the message")
        XCTAssertEqual(fixtureID(model, draft), "069")
    }

    func testSimulatedEmptyTakeIsNothingHeard() async {
        let model = makeModel(failures: .nothingHeard)
        await recordTake(model)
        XCTAssertEqual(model.recordProblem, .nothingHeard)
        let next = await recordTake(model)
        XCTAssertNotNil(next, "failures happen once")
    }

    func testCouldNotStartThenTryAgainRecords() async {
        let model = makeModel(failures: .couldNotStart)
        await model.startRecording()
        XCTAssertEqual(model.capture, .idle)
        XCTAssertEqual(model.recordProblem, .couldNotStart)
        await model.startRecording()
        XCTAssertTrue(model.isRecording)
        XCTAssertNil(model.recordProblem)
    }

    func testInterruptionLosesTheTake() async throws {
        let model = makeModel(failures: .interrupted)
        await model.startRecording()
        XCTAssertTrue(model.isRecording)
        for _ in 0..<100 where model.isRecording {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(model.capture, .idle)
        XCTAssertEqual(model.recordProblem, .interrupted)
        XCTAssertNil(model.flow, "nothing was saved")

        let draft = await recordTake(model)
        XCTAssertEqual(fixtureID(model, draft), "069")
    }

    // MARK: Review and Result

    func testSaveAnalyzesAndShowsTheResult() async throws {
        let model = makeModel()
        await recordTake(model)
        await model.saveDraft()
        let result = try XCTUnwrap(result(model))
        let recording = try XCTUnwrap(model.recording(result.recordingID))
        XCTAssertEqual(recording.name, "Recording 1")
        XCTAssertEqual(recording.analysis, .analyzed(RecordingAnalysis(pitch: nil, firstFartUsed: false)))
        XCTAssertTrue(result.changes.unlocked.isEmpty)
        XCTAssertTrue(result.changes.improved.isEmpty, "a Noise-like Recording covers nothing")

        model.finishFlow()
        XCTAssertNil(model.flow)
        let melodic = await recordTake(model)
        XCTAssertEqual(fixtureID(model, melodic), "021")
        await model.saveDraft()
        let second = try XCTUnwrap(self.result(model))
        XCTAssertEqual(model.recording(second.recordingID)?.pitch, 48.23)
        XCTAssertFalse(second.changes.improved.isEmpty, "the first Melodic Recording covers a pitch of every Song")
    }

    func testFirstFartUsedComesFromTheAnalysis() async {
        let model = makeModel(start: Array(SampleFixture.prototypeStory.prefix(3)))
        await recordTake(model)
        await model.saveDraft()
        let recording = model.recordings.last
        XCTAssertEqual(recording?.analysis, .analyzed(RecordingAnalysis(pitch: nil, firstFartUsed: true)), "052 had a second fart cut")
    }

    func testStoryUnlocksMaryAtTheSixthMelodicRecording() async throws {
        let model = makeModel()
        var unlocks: [Int: [String]] = [:]
        for _ in SampleFixture.prototypeStory {
            await recordTake(model)
            await model.saveDraft()
            let result = try XCTUnwrap(result(model))
            if !result.changes.unlocked.isEmpty {
                unlocks[model.melodicRecordings.count] = result.changes.unlocked.map(\.id)
            }
            model.finishFlow()
        }
        XCTAssertEqual(unlocks, [6: ["mary"], 8: ["jingle", "saints", "ode"], 9: ["twinkle", "row"]])
        XCTAssertEqual(Song.prototypeCatalog.filter { model.coverage(of: $0).isUnlocked }.count, 6)
    }

    func testDiscardKeepsNothing() async {
        let model = makeModel()
        await recordTake(model)
        model.discardDraft()
        XCTAssertNil(model.flow)
        XCTAssertTrue(model.recordings.isEmpty)
        let next = await recordTake(model)
        XCTAssertEqual(fixtureID(model, next), "069", "a discarded take comes around again")
    }

    func testSaveFailedKeepsTheDraftUntilTryAgain() async throws {
        let model = makeModel(failures: .saveFailed)
        let take = await recordTake(model)
        let draft = try XCTUnwrap(take)
        await model.saveDraft()
        XCTAssertEqual(model.flow, .saveFailed(draft))
        XCTAssertTrue(model.recordings.isEmpty)
        await model.saveDraft()
        XCTAssertNotNil(result(model))
        XCTAssertEqual(model.recordings.count, 1)
    }

    func testSaveFailedThenDiscard() async {
        let model = makeModel(failures: .saveFailed)
        await recordTake(model)
        await model.saveDraft()
        model.discardDraft()
        XCTAssertNil(model.flow)
        XCTAssertTrue(model.recordings.isEmpty)
    }

    func testAnalysisFailedKeepsTheRecordingThenRetryShowsTheResult() async throws {
        let model = makeModel(failures: .analysisFailed)
        await recordTake(model)
        await model.saveDraft()
        let recording = try XCTUnwrap(model.recordings.first)
        XCTAssertEqual(model.flow, .analysisFailed(recording.id))
        XCTAssertEqual(recording.analysis, .notAnalyzed)

        await model.retryAnalysis(of: recording.id)
        XCTAssertEqual(result(model)?.recordingID, recording.id)
        XCTAssertEqual(model.recordings.first?.analysis, .analyzed(RecordingAnalysis(pitch: nil, firstFartUsed: false)))
    }

    func testRetryFromTheRecordingsTabAnalyzesInPlace() async throws {
        let model = makeModel(failures: .analysisFailed)
        await recordTake(model)
        await model.saveDraft()
        model.finishFlow()
        let recording = try XCTUnwrap(model.recordings.first)
        XCTAssertEqual(recording.analysis, .notAnalyzed)

        await model.retryAnalysis(of: recording.id)
        XCTAssertNil(model.flow, "retrying from the list doesn't open Result")
        XCTAssertEqual(model.recordings.first?.analysis, .analyzed(RecordingAnalysis(pitch: nil, firstFartUsed: false)))
    }

    // MARK: Recordings

    func testDeleteRemovesTheRecordingAndNumbersKeepCounting() async {
        let model = makeModel(start: ["069", "021", "090"])
        let last = model.recordings[2]
        model.delete(model.recordings[1].id)
        XCTAssertEqual(model.recordings.map(\.name), ["Recording 1", "Recording 3"])
        XCTAssertEqual(model.melodicRecordings.map(\.id), [last.id])

        let draft = await recordTake(model)
        XCTAssertEqual(fixtureID(model, draft), "021", "a deleted fixture comes around again")
        await model.saveDraft()
        XCTAssertEqual(model.recordings.last?.name, "Recording 4")
    }

    func testAllStartHasEveryFixtureAnalyzed() {
        let model = makeModel(start: SampleFixture.prototypeLibrary.map(\.id))
        XCTAssertEqual(model.recordings.count, 23)
        XCTAssertEqual(model.melodicRecordings.count, 9)
        XCTAssertEqual(model.recordings.filter { if case .analyzed(let a) = $0.analysis { a.firstFartUsed } else { false } }.count, 10)
        XCTAssertEqual(Song.prototypeCatalog.filter { model.coverage(of: $0).isUnlocked }.map(\.id), ["twinkle", "mary", "jingle", "saints", "row", "ode"])
    }

    func testWithoutFixturesTheModelStartsEmptyAndCannotRecord() async {
        let model = makeModel(fixtures: [], story: [])
        XCTAssertTrue(model.recordings.isEmpty)
        await model.startRecording()
        XCTAssertEqual(model.recordProblem, .couldNotStart)
        XCTAssertEqual(model.capture, .idle)
    }

    // MARK: Sample data

    func testSampleDataMatchesThePrototype() {
        let library = SampleFixture.prototypeLibrary
        XCTAssertEqual(library.count, 23)
        XCTAssertEqual(library.filter { $0.pitch != nil }.count, 9)
        XCTAssertEqual(Song.prototypeCatalog.count, 12)
        XCTAssertEqual(SampleFixture.prototypeStory.count, 12)
        XCTAssertTrue(SampleFixture.prototypeStory.allSatisfy { id in library.contains { $0.id == id } })
    }

    func testEverySongHasPlayableStandInAudioInDebugBuilds() throws {
        for song in Song.prototypeCatalog {
            let url = try XCTUnwrap(song.prototypeAudioURL, "no bundled audio for \(song.id)")
            let player = try AVAudioPlayer(contentsOf: url)
            let notesEnd = song.beats * 60 / Double(song.bpm)
            // The render holds the last note a little past the score's end.
            XCTAssertEqual(player.duration, notesEnd, accuracy: 1.5, song.id)
            XCTAssertGreaterThan(player.duration, notesEnd, song.id)
        }
    }

    func testEveryFixtureHasPlayableAudioInDebugBuilds() throws {
        for fixture in SampleFixture.prototypeLibrary {
            let url = try XCTUnwrap(fixture.audioURL, "no bundled audio for \(fixture.id)")
            let player = try AVAudioPlayer(contentsOf: url)
            XCTAssertEqual(player.duration, fixture.seconds, accuracy: 0.1, fixture.id)
        }
    }

    // MARK: Compose

    func testCoverageFollowsTheRecordings() async {
        let model = makeModel(start: Array(SampleFixture.prototypeStory.prefix(7)))
        let mary = song("mary")
        XCTAssertEqual(model.coverage(of: mary).summary, "3 of 4 notes covered")
        await recordTake(model)
        await model.saveDraft()
        XCTAssertTrue(model.coverage(of: mary).isUnlocked, "the 8th take (086) unlocks Mary")
        model.delete(model.recordings.last!.id)
        XCTAssertFalse(model.coverage(of: mary).isUnlocked, "deleting it locks Mary again")
    }

    func testSongListingHasSixUnlockedSongsWithAllRecordings() {
        let model = makeModel(start: allFixtureIDs)
        let listing = model.songListing(matching: "", order: .closestToUnlocking)
        XCTAssertEqual(listing.unlocked.map(\.song.id), ["mary", "jingle", "saints", "ode", "twinkle", "row"])
        XCTAssertEqual(listing.locked.count, 6)
    }

    /// The Recording the user has for a Fixture Library id (the oldest, if there are several).
    private func recording(ofFixture fixtureID: String, in model: SampleAppModel) -> Recording.ID? {
        let index = SampleFixture.prototypeLibrary.firstIndex { $0.id == fixtureID }!
        return model.recordings.first { $0.number == index + 1 }?.id
    }

    func testWithEveryFixtureATootShowsTheRecordingsItsStandInWasRenderedWith() async throws {
        // With all 23 fixtures (recording n is library fixture n), every Unlocked Song's
        // Arrangement is its render's: the list, the note colors and the sound agree.
        let model = makeModel(start: allFixtureIDs)
        let unlocked = Song.prototypeCatalog.filter { model.coverage(of: $0).isUnlocked }
        XCTAssertEqual(unlocked.count, 6)
        for song in unlocked {
            let draft = try await model.makeToot(of: song)
            let render = try XCTUnwrap(Song.prototypeRenders[song.id])
            XCTAssertEqual(draft.arrangement.recordingForPitch.keys.sorted(), song.pitches, song.id)
            XCTAssertEqual(draft.arrangement.transposition, render.transposition, song.id)
            for (pitch, fixtureID) in render.fixtureForPitch {
                XCTAssertEqual(draft.arrangement.recordingForPitch[pitch], recording(ofFixture: fixtureID, in: model), "\(song.id) pitch \(pitch)")
            }
            XCTAssertEqual(model.simulatedSource(ofToot: draft.id), "the design prototype's render of this Song, with these Recordings")
        }
    }

    func testMakingAnUnlockedSongReturnsItsStandInAudio() async throws {
        let model = makeModel(start: allFixtureIDs)
        let mary = song("mary")
        let draft = try await model.makeToot(of: mary)
        XCTAssertEqual(draft.song, mary)
        XCTAssertEqual(draft.audioURL, mary.prototypeAudioURL)
        XCTAssertEqual(draft.seconds, 12.46, accuracy: 0.05, "the length of the prototype's render")
        // Mary's render plays fixtures 090, 084, 086 and 094, lowest pitch first.
        XCTAssertEqual(draft.arrangement.recordings.compactMap { model.recording($0)?.name }, ["Recording 21", "Recording 19", "Recording 20", "Recording 23"])
        XCTAssertTrue(model.toots.isEmpty, "nothing is saved until Save")

        model.togglePlayback(of: .tootDraft(draft.id))
        XCTAssertEqual(model.nowPlaying, .tootDraft(draft.id))
        model.stopPlayback()
    }

    func testWithoutARenderFixtureATootShowsPitchCoveragesMatchingAndSaysSo() async throws {
        // After the 8-take story Mary is unlocked, but its render's fixture 084 isn't there.
        let model = makeModel(start: Array(SampleFixture.prototypeStory.prefix(8)))
        let mary = song("mary")
        let draft = try await model.makeToot(of: mary)
        XCTAssertEqual(draft.arrangement, model.coverage(of: mary).matchedArrangement)
        XCTAssertEqual(model.simulatedSource(ofToot: draft.id), "the design prototype's render of this Song, not made from these Recordings")
    }

    func testLockedSongsCantBeMade() async {
        let model = makeModel(start: allFixtureIDs)
        do {
            _ = try await model.makeToot(of: song("birthday"))
            XCTFail("Happy Birthday is locked")
        } catch {
            XCTAssertEqual(error as? TootError, .locked)
        }
    }

    func testCouldNotMakeTootHappensOnceThenTryAgainWorks() async throws {
        let model = makeModel(start: allFixtureIDs, failures: .couldNotMakeToot)
        do {
            _ = try await model.makeToot(of: song("mary"))
            XCTFail("the simulated failure didn't happen")
        } catch {
            XCTAssertEqual(error as? TootError, .couldNotMake)
        }
        _ = try await model.makeToot(of: song("mary"))
    }

    func testWithoutSongAudioTootsCantBeMade() async {
        // Release builds carry no stand-in audio, so Song Creator reports it can't make one.
        let model = makeModel(start: allFixtureIDs, songAudio: { _ in nil }, renders: [:])
        do {
            _ = try await model.makeToot(of: song("mary"))
            XCTFail("made a Toot without audio")
        } catch {
            XCTAssertEqual(error as? TootError, .couldNotMake)
        }
    }

    func testSavingAddsATootOnce() async throws {
        let model = makeModel(start: allFixtureIDs)
        let draft = try await model.makeToot(of: song("ode"))
        model.saveToot(draft)
        model.saveToot(draft)
        XCTAssertEqual(model.toots.count, 1, "saving twice keeps one")
        let toot = try XCTUnwrap(model.toot(draft.id))
        XCTAssertEqual(toot.title, "Ode to Joy")
        XCTAssertEqual(toot.songID, "ode")
        XCTAssertEqual(toot.createdAt, clock)
        XCTAssertEqual(toot.seconds, draft.seconds)
        XCTAssertFalse(toot.isAudioMissing)

        model.togglePlayback(of: .toot(toot.id))
        XCTAssertEqual(model.nowPlaying, .toot(toot.id))
        model.stopPlayback()
    }

    func testTootsAtLaunchAreOldestFirst() {
        let model = makeModel(start: allFixtureIDs, toots: ["twinkle", "mary", "nonexistent"])
        XCTAssertEqual(model.toots.map(\.title), ["Twinkle, Twinkle, Little Star", "Mary Had a Little Lamb"])
        XCTAssertEqual(model.toots.map(\.songID), ["twinkle", "mary"])
        XCTAssertEqual(model.toots.map { $0.seconds.rounded() }, [18, 12])
    }

    func testRenameTrimsAndIgnoresABlankTitle() {
        let model = makeModel(toots: ["mary"])
        let id = model.toots[0].id
        model.renameToot(id, to: "  Lamb Toots \n")
        XCTAssertEqual(model.toots[0].title, "Lamb Toots")
        XCTAssertEqual(model.toots[0].songID, "mary", "renaming keeps the Song")
        model.renameToot(id, to: "   ")
        XCTAssertEqual(model.toots[0].title, "Lamb Toots")
    }

    func testDeletingATootStopsItPlaying() {
        let model = makeModel(toots: ["mary", "ode"])
        let mary = model.toots[0].id
        model.togglePlayback(of: .toot(mary))
        XCTAssertEqual(model.nowPlaying, .toot(mary))
        model.deleteToot(mary)
        XCTAssertNil(model.nowPlaying)
        XCTAssertEqual(model.toots.map(\.title), ["Ode to Joy"])
    }

    func testMissingTootAudioIsCheckedOnceAndNothingPlays() {
        let model = makeModel(toots: ["mary", "ode"], failures: .tootAudioMissing)
        XCTAssertEqual(model.toots.map(\.isAudioMissing), [true, false], "the first Toot lost its audio")
        XCTAssertTrue(Toot.isAudioMissing(at: model.toots[0].audioURL))
        model.togglePlayback(of: .toot(model.toots[0].id))
        XCTAssertNil(model.nowPlaying)
    }

    // MARK: A Toot's Arrangement and its notes

    func testATootKeepsItsArrangementFromWhenItWasMade() async throws {
        let model = makeModel(start: allFixtureIDs)
        let draft = try await model.makeToot(of: song("mary"))
        model.saveToot(draft)
        let saved = try XCTUnwrap(model.toot(draft.id))
        XCTAssertEqual(saved.arrangement, draft.arrangement)

        // Deleting a Recording it used doesn't change it, and the Toot still plays.
        let used = try XCTUnwrap(draft.arrangement.recordingForPitch[74])
        XCTAssertEqual(model.recording(used)?.name, "Recording 19")
        model.delete(used)
        XCTAssertNil(model.recording(used))
        XCTAssertEqual(model.toot(draft.id)?.arrangement, draft.arrangement, "the Arrangement was recomputed")
        model.togglePlayback(of: .toot(draft.id))
        XCTAssertEqual(model.nowPlaying, .toot(draft.id), "a Toot plays its own audio")
        model.stopPlayback()
    }

    func testTootsAtLaunchKeepTheRecordingsTheirRenderUsed() throws {
        let model = makeModel(start: allFixtureIDs, toots: ["mary"])
        let toot = try XCTUnwrap(model.toots.first)
        XCTAssertEqual(toot.arrangement.transposition, -19)
        XCTAssertEqual(toot.arrangement.recordings.compactMap { model.recording($0)?.name }, ["Recording 21", "Recording 19", "Recording 20", "Recording 23"])
    }

    func testANotePlaysAsASegmentOfTheTootsAudio() async throws {
        let model = makeModel(start: allFixtureIDs)
        let draft = try await model.makeToot(of: song("mary"))
        model.togglePlayback(of: .tootDraft(draft.id))
        model.togglePlayback(of: .note(draft.id, index: 25))
        XCTAssertEqual(model.nowPlaying, .note(draft.id, index: 25), "a note replaces the whole Toot")
        model.togglePlayback(of: .note(draft.id, index: 25))
        XCTAssertNil(model.nowPlaying, "tapping the playing note stops it")
        model.togglePlayback(of: .note(draft.id, index: 99))
        XCTAssertNil(model.nowPlaying, "a note that doesn't exist plays nothing")
    }

    func testTheCaptionOfASelectedNote() async throws {
        let model = makeModel(start: allFixtureIDs)
        let mary = song("mary")
        let draft = try await model.makeToot(of: mary)
        let arrangement = draft.arrangement
        let recording = { (note: Song.Note) in arrangement.recording(playing: note).flatMap { model.recording($0) } }

        // The render plays Mary's first note, A3, with fixture 086 (G♯3, 55.83) moved up 1.17.
        let first = mary.notes[0]
        XCTAssertEqual(try XCTUnwrap(arrangement.shift(of: first, by: try XCTUnwrap(recording(first)))), 57 - 55.83, accuracy: 1e-9)
        XCTAssertEqual(arrangement.caption(of: first, in: mary, recording: recording(first)), "A3 · Recording 20 (G♯3), shifted +1.2 semitones · 0.4 s")
        // Its last note, F3, with fixture 090 (G3, 55.13) moved down 2.13.
        let last = mary.notes[25]
        XCTAssertEqual(arrangement.caption(of: last, in: mary, recording: recording(last)), "F3 · Recording 21 (G3), shifted −2.1 semitones · 1.4 s")
        XCTAssertEqual(arrangement.caption(of: last, in: mary, recording: nil), "F3 · Recording deleted · 1.4 s")
    }

    // MARK: Background

    func testGoingToTheBackgroundStopsPlayback() async throws {
        let model = makeModel(start: allFixtureIDs, toots: ["ode"])
        model.togglePlayback(of: .toot(model.toots[0].id))
        XCTAssertEqual(model.nowPlaying, .toot(model.toots[0].id))
        model.didEnterBackground()
        XCTAssertNil(model.nowPlaying)

        // Also while Review is open, where coming back doesn't switch tabs.
        let take = await recordTake(model)
        let draft = try XCTUnwrap(take)
        model.togglePlayback(of: .draft(draft.id))
        XCTAssertEqual(model.nowPlaying, .draft(draft.id))
        model.didEnterBackground()
        XCTAssertNil(model.nowPlaying)
    }

    func testComingBackLandsOnRecordUnlessTheRecordFlowIsOpen() async throws {
        let model = makeModel()
        for tab in [AppTab.record, .recordings, .compose, .toots] {
            XCTAssertEqual(model.tabOnReturn(from: tab), .record)
        }
        await model.startRecording()
        XCTAssertEqual(model.tabOnReturn(from: .record), .record, "recording starts on Record")
        clock += 1
        await model.stopRecording()
        XCTAssertNotNil(model.flow, "Review is open")
        XCTAssertEqual(model.tabOnReturn(from: .recordings), .recordings, "Review stays where it is")
        model.discardDraft()
        XCTAssertEqual(model.tabOnReturn(from: .recordings), .record)
    }
}
