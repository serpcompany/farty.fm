import AVFAudio
import Synchronization
import XCTest
@testable import Pedos

/// Real recording against a temporary folder. The microphone is replaced by a test take (fixture
/// 090 as the recorder writes it, mono 44.1 kHz AAC), and Recording Analysis by a stand-in that
/// counts its runs; everything else is the real store and model.
@MainActor
final class LiveRecordingSourceTests: XCTestCase {
    private var root: URL!
    private var store: RecordingStore!
    private var testTake: URL!
    private var defaults: UserDefaults!
    private var suiteName = ""
    private var clock = Date(timeIntervalSinceReferenceDate: 0)

    override func setUp() async throws {
        root = URL.temporaryDirectory.appending(path: "LiveRecordingSourceTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        store = RecordingStore(
            folder: root.appending(path: "Recordings", directoryHint: .isDirectory),
            draftFolder: root.appending(path: "Drafts", directoryHint: .isDirectory)
        )
        try FileManager.default.createDirectory(at: store.draftFolder, withIntermediateDirectories: true)
        testTake = try Self.makeTestTake(in: root)
        suiteName = "LiveRecordingSourceTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        defaults.set(true, forKey: SampleAppModel.welcomeSeenKey)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
        defaults.removePersistentDomain(forName: suiteName)
    }

    /// Fixture 090 (bundled in Debug builds) written as AAC, like the recorder's takes.
    private static func makeTestTake(in folder: URL) throws -> URL {
        let fixture = try XCTUnwrap(SampleFixture.prototypeLibrary.first { $0.id == "090" }?.audioURL)
        let input = try AVAudioFile(forReading: fixture)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: input.processingFormat, frameCapacity: AVAudioFrameCount(input.length)))
        try input.read(into: buffer)
        let url = folder.appending(path: "test-take.m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: input.processingFormat.sampleRate,
            AVNumberOfChannelsKey: input.processingFormat.channelCount,
        ]
        let output = try AVAudioFile(forWriting: url, settings: settings)
        try output.write(from: buffer)
        return url
    }

    /// A stand-in for Recording Analysis that finds G3 starting 50 ms in, and counts its runs.
    private final class Analysis: Sendable {
        let runs = Mutex(0)
        let fails = Mutex(false)

        func analyzer(version: Int = 1) -> LiveRecordingSource.Analyzer {
            LiveRecordingSource.Analyzer(version: version) { [self] url in
                runs.withLock { $0 += 1 }
                if fails.withLock({ $0 }) { throw CocoaError(.fileReadCorruptFile) }
                XCTAssertNotNil(AudioLength.seconds(of: url), "Analysis got a file it can't read")
                return SavedAnalysis(
                    version: version, gestureStartSeconds: 0.05, gestureEndSeconds: 0.5, cutAtReattack: false,
                    pitchEstimateMIDI: 55.1, pitchConfidence: 0.8, recordingPitchMIDI: 55.1, shortestNoteSeconds: 0.2
                )
            }
        }
    }

    private func makeModel(_ source: LiveRecordingSource) -> SampleAppModel {
        SampleAppModel(
            source: source,
            songs: Song.prototypeCatalog,
            microphone: SimulatedMicrophone(permission: .granted),
            defaults: defaults,
            now: { [unowned self] in clock }
        )
    }

    /// Records a take of a second and saves it, waiting for the analysis.
    private func recordAndSave(_ model: SampleAppModel) async throws -> Recording {
        await model.startRecording()
        clock += 1
        await model.stopRecording()
        guard case .review(let draft) = model.flow else {
            XCTFail("No Review: \(String(describing: model.flow))")
            throw CocoaError(.featureUnsupported)
        }
        XCTAssertEqual(draft.seconds, try XCTUnwrap(AudioLength.seconds(of: testTake)), accuracy: 0.01)
        XCTAssertFalse(draft.waveform.isEmpty)
        await model.saveDraft()
        return try XCTUnwrap(model.recordings.last)
    }

    func testRecordSaveAndSeeThePitch() async throws {
        let analysis = Analysis()
        let model = makeModel(LiveRecordingSource(store: store, analyzer: analysis.analyzer(), testTake: testTake))

        let recording = try await recordAndSave(model)

        XCTAssertEqual(recording.number, 1)
        XCTAssertEqual(recording.pitch, 55.1)
        // Replay plays the fart the analysis found, without the dead air around it.
        XCTAssertEqual(recording.replaySegment?.start, 0.05)
        XCTAssertEqual(try XCTUnwrap(recording.replaySegment?.length), 0.45, accuracy: 1e-9)
        guard case .result(let result) = model.flow else { return XCTFail("No Result: \(String(describing: model.flow))") }
        XCTAssertEqual(result.recordingID, recording.id)
        XCTAssertEqual(try store.load().map(\.id), [recording.id], "The take wasn't saved as a file")
        XCTAssertEqual(analysis.runs.withLock { $0 }, 1)
    }

    func testRecordingsAndTheirAnalysisSurviveARelaunch() async throws {
        let analysis = Analysis()
        let first = makeModel(LiveRecordingSource(store: store, analyzer: analysis.analyzer(), testTake: testTake))
        let saved = try await recordAndSave(first)

        let relaunched = makeModel(LiveRecordingSource(store: store, analyzer: analysis.analyzer(), testTake: testTake))

        XCTAssertEqual(relaunched.recordings, [saved])
        XCTAssertEqual(analysis.runs.withLock { $0 }, 1, "A kept analysis ran again")
    }

    func testANewAnalysisVersionAnalyzesAgain() async throws {
        let analysis = Analysis()
        let first = makeModel(LiveRecordingSource(store: store, analyzer: analysis.analyzer(version: 1), testTake: testTake))
        let saved = try await recordAndSave(first)

        let updated = makeModel(LiveRecordingSource(store: store, analyzer: analysis.analyzer(version: 2), testTake: testTake))
        XCTAssertEqual(updated.recordings.first?.analysis, .analyzing)
        for _ in 0..<100 where updated.recordings.first?.analysis == .analyzing {
            try await Task.sleep(for: .milliseconds(20))
        }

        XCTAssertEqual(updated.recordings.first?.pitch, 55.1)
        XCTAssertEqual(analysis.runs.withLock { $0 }, 2)
        XCTAssertEqual(store.analysis(of: saved.id, as: SavedAnalysis.self)?.version, 2)
    }

    func testAFailedAnalysisKeepsTheRecording() async throws {
        let analysis = Analysis()
        analysis.fails.withLock { $0 = true }
        let model = makeModel(LiveRecordingSource(store: store, analyzer: analysis.analyzer(), testTake: testTake))

        let recording = try await recordAndSave(model)

        XCTAssertEqual(recording.analysis, .notAnalyzed)
        XCTAssertEqual(model.flow, .analysisFailed(recording.id))
        XCTAssertEqual(try store.load().map(\.id), [recording.id])

        analysis.fails.withLock { $0 = false }
        await model.retryAnalysis(of: recording.id)
        XCTAssertEqual(model.recordings.first?.pitch, 55.1)
    }

    func testDeleteRemovesTheRecordingAndItsAnalysis() async throws {
        let analysis = Analysis()
        let model = makeModel(LiveRecordingSource(store: store, analyzer: analysis.analyzer(), testTake: testTake))
        let recording = try await recordAndSave(model)
        model.finishFlow()

        model.delete(recording.id)

        XCTAssertEqual(model.recordings, [])
        XCTAssertEqual(try store.load(), [])
        XCTAssertNil(store.analysis(of: recording.id, as: SavedAnalysis.self))
    }

    func testDiscardDeletesTheTake() async throws {
        let model = makeModel(LiveRecordingSource(store: store, analyzer: Analysis().analyzer(), testTake: testTake))
        await model.startRecording()
        clock += 1
        await model.stopRecording()
        guard case .review(let draft) = model.flow, let url = draft.audioURL else { return XCTFail("No Review") }
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path(percentEncoded: false)))

        model.discardDraft()

        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path(percentEncoded: false)))
        XCTAssertEqual(try store.load(), [])
    }

    func testATooShortTakeIsNothingHeard() async throws {
        let model = makeModel(LiveRecordingSource(store: store, analyzer: Analysis().analyzer(), testTake: testTake))
        await model.startRecording()
        clock += 0.2
        await model.stopRecording()

        XCTAssertEqual(model.recordProblem, .nothingHeard)
        XCTAssertNil(model.flow)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: store.draftFolder.path(percentEncoded: false)), [])
    }

    func testASecondSaveTapDoesNothing() async throws {
        let model = makeModel(LiveRecordingSource(store: store, analyzer: Analysis().analyzer(), testTake: testTake))
        await model.startRecording()
        clock += 1
        await model.stopRecording()

        async let first: Void = model.saveDraft()
        async let second: Void = model.saveDraft()
        _ = await (first, second)

        XCTAssertEqual(model.recordings.count, 1)
        XCTAssertEqual(try store.load().count, 1)
        guard case .result = model.flow else { return XCTFail("No Result: \(String(describing: model.flow))") }
    }
}
