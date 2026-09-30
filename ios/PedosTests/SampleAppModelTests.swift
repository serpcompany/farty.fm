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
        microphone: MicrophoneAccess = SimulatedMicrophone(permission: .granted),
        failures: SampleAppModel.Failures = [],
        fixtures: [SampleFixture] = SampleFixture.prototypeLibrary,
        story: [String] = SampleFixture.prototypeStory
    ) -> SampleAppModel {
        SampleAppModel(
            fixtures: fixtures,
            story: story,
            songs: Song.prototypeCatalog,
            initialFixtureIDs: start,
            microphone: microphone,
            defaults: defaults,
            failures: failures,
            now: { [unowned self] in clock },
            analysisDelay: .zero,
            interruptionDelay: .zero
        )
    }

    /// Records for one second and stops, returning the draft under Review.
    @discardableResult
    private func recordTake(_ model: SampleAppModel, seconds: TimeInterval = 1) async -> Draft? {
        await model.startRecording()
        clock += seconds
        model.stopRecording()
        if case .review(let draft) = model.flow { return draft }
        return nil
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
            taken.append(draft?.sampleFixtureID ?? "none")
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
        XCTAssertEqual(again?.sampleFixtureID, SampleFixture.prototypeStory[23 % 12])
    }

    func testStartingPointsContinueTheStory() async {
        let model = makeModel(start: Array(SampleFixture.prototypeStory.prefix(3)))
        XCTAssertEqual(model.recordings.map(\.name), ["Recording 1", "Recording 2", "Recording 3"])
        XCTAssertEqual(model.melodicRecordings.count, 2)
        let draft = await recordTake(model)
        XCTAssertEqual(draft?.sampleFixtureID, "052")
    }

    func testRecordingShowsTheTakeInReview() async {
        let model = makeModel()
        await model.startRecording()
        XCTAssertEqual(model.capture, .recording(startedAt: clock))
        clock += 2
        model.stopRecording()
        guard case .review(let draft) = model.flow else { return XCTFail("no Review: \(String(describing: model.flow))") }
        XCTAssertEqual(draft.sampleFixtureID, "069")
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
        XCTAssertEqual(draft?.sampleFixtureID, "069")
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
        XCTAssertEqual(draft?.sampleFixtureID, "069")
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
        XCTAssertEqual(melodic?.sampleFixtureID, "021")
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
        XCTAssertEqual(next?.sampleFixtureID, "069", "a discarded take comes around again")
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
        XCTAssertEqual(draft?.sampleFixtureID, "021", "a deleted fixture comes around again")
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

    func testEveryFixtureHasPlayableAudioInDebugBuilds() throws {
        for fixture in SampleFixture.prototypeLibrary {
            let url = try XCTUnwrap(fixture.audioURL, "no bundled audio for \(fixture.id)")
            let player = try AVAudioPlayer(contentsOf: url)
            XCTAssertEqual(player.duration, fixture.seconds, accuracy: 0.1, fixture.id)
        }
    }
}
