import AVFAudio
import XCTest
@testable import Pedos

/// "Load the Fixture Library" (internal builds) against a temporary folder, with a stand-in for
/// Recording Analysis so the test is quick. `FixtureLibraryUITests` runs the real analysis.
@MainActor
final class FixtureLibraryTests: XCTestCase {
    private var root: URL!
    private var store: RecordingStore!
    private var defaults: UserDefaults!
    private var suiteName = ""

    override func setUp() async throws {
        root = URL.temporaryDirectory.appending(path: "FixtureLibraryTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        store = RecordingStore(
            folder: root.appending(path: "Recordings", directoryHint: .isDirectory),
            draftFolder: root.appending(path: "Drafts", directoryHint: .isDirectory)
        )
        suiteName = "FixtureLibraryTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
        defaults.removePersistentDomain(forName: suiteName)
    }

    private let analyzer = LiveRecordingSource.Analyzer(version: 1) { _ in
        SavedAnalysis(
            version: 1, gestureStartSeconds: 0, gestureEndSeconds: 0.5, cutAtReattack: false,
            pitchEstimateMIDI: nil, pitchConfidence: 0, recordingPitchMIDI: nil, shortestNoteSeconds: nil
        )
    }

    private func makeModel() -> SampleAppModel {
        SampleAppModel(
            source: LiveRecordingSource(store: store, analyzer: analyzer),
            songs: Song.prototypeCatalog,
            microphone: SimulatedMicrophone(permission: .granted),
            defaults: defaults
        )
    }

    func testTheBuildCarriesAll23Fixtures() {
        let fixtures = FixtureLibrary.bundled()
        XCTAssertEqual(fixtures.count, 23)
        XCTAssertEqual(fixtures.first?.id, "002")
        XCTAssertEqual(fixtures.last?.id, "094")
        XCTAssertEqual(Set(fixtures.map(\.id)), Set(SampleFixture.prototypeLibrary.map(\.id)))
    }

    /// Fixtures come as 44.1 and 48 kHz, mono and stereo, MP3 and WAV; each is stored the way the
    /// recorder writes a take, with its length kept.
    func testAFixtureIsWrittenAsATake() throws {
        for fixture in FixtureLibrary.bundled() where ["002", "090"].contains(fixture.id) {
            let take = root.appending(path: "\(fixture.id).m4a")
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try FixtureLibrary.writeAsTake(fixture.url, to: take)

            let written = try AVAudioFile(forReading: take)
            XCTAssertEqual(written.fileFormat.settings[AVFormatIDKey] as? Int, Int(kAudioFormatMPEG4AAC), fixture.id)
            XCTAssertEqual(written.fileFormat.sampleRate, 44_100, fixture.id)
            XCTAssertEqual(written.fileFormat.channelCount, 1, fixture.id)
            let original = try XCTUnwrap(AudioLength.seconds(of: fixture.url))
            XCTAssertEqual(try XCTUnwrap(AudioLength.seconds(of: take)), original, accuracy: 0.05, fixture.id)
        }
    }

    func testLoadingAddsEveryFixtureOnceAndAgainOnlyWhatsMissing() async throws {
        let model = makeModel()
        XCTAssertEqual(model.fixtureLibrary, FixtureLibraryStatus(loaded: 0, total: 23, isLoading: false))

        await model.loadFixtureLibrary()
        XCTAssertEqual(model.recordings.count, 23)
        XCTAssertEqual(model.recordings.map(\.number), Array(1...23))
        XCTAssertEqual(model.fixtureLibrary, FixtureLibraryStatus(loaded: 23, total: 23, isLoading: false))
        XCTAssertTrue(model.recordings.allSatisfy { if case .analyzed = $0.analysis { true } else { false } })

        await model.loadFixtureLibrary()
        XCTAssertEqual(model.recordings.count, 23, "Loading twice duplicated Recordings")

        // Deleting one and loading again adds back only that one, and it survives a relaunch.
        let deleted = try XCTUnwrap(model.recordings.first { $0.number == 5 })
        model.delete(deleted.id)
        await model.loadFixtureLibrary()
        XCTAssertEqual(model.recordings.count, 23)
        XCTAssertEqual(makeModel().fixtureLibrary?.loaded, 23)
        XCTAssertEqual(try store.load().count, 23)
    }

    func testTheSampleModelHasNoLoader() {
        let model = SampleAppModel(
            fixtures: SampleFixture.prototypeLibrary,
            story: SampleFixture.prototypeStory,
            songs: Song.prototypeCatalog,
            microphone: SimulatedMicrophone(permission: .granted),
            defaults: defaults
        )
        XCTAssertNil(model.fixtureLibrary)
    }
}
