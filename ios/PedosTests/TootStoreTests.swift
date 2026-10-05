import AVFAudio
import XCTest
@testable import Pedos

/// #18: Toots are kept across relaunch, with their own copy of the audio, and rename and delete
/// are kept too. Each "launch" is a new model on the same folders.
@MainActor
final class TootStoreTests: XCTestCase {
    private var root: URL!
    private var store: TootStore!
    private var defaults: UserDefaults!
    private var suiteName = ""
    private var clock = Date(timeIntervalSinceReferenceDate: 800_000_000)

    override func setUp() async throws {
        root = URL.temporaryDirectory.appending(path: "TootStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        store = TootStore(folder: root.appending(path: "Toots", directoryHint: .isDirectory))
        suiteName = "TootStoreTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        defaults.set(true, forKey: SampleAppModel.welcomeSeenKey)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
        defaults.removePersistentDomain(forName: suiteName)
    }

    /// A launch of the app with all 23 fixtures and the Toots in `store`.
    private func launch(failures: SampleAppModel.Failures = []) -> SampleAppModel {
        SampleAppModel(
            fixtures: SampleFixture.prototypeLibrary,
            story: SampleFixture.prototypeStory,
            songs: Song.prototypeCatalog,
            initialFixtureIDs: SampleFixture.prototypeLibrary.map(\.id),
            tootFolder: root.appending(path: "Drafts", directoryHint: .isDirectory),
            tootStore: store,
            microphone: SimulatedMicrophone(permission: .granted),
            defaults: defaults,
            failures: failures,
            now: { [unowned self] in clock },
            analysisDelay: .zero
        )
    }

    /// Makes and saves a Toot of each Song, a second apart.
    @discardableResult
    private func save(_ songIDs: [Song.ID], in model: SampleAppModel) async throws -> [Toot] {
        var saved: [Toot] = []
        for id in songIDs {
            let draft = try await model.makeToot(of: try XCTUnwrap(model.song(id)))
            model.saveToot(draft)
            saved.append(try XCTUnwrap(model.toot(draft.id)))
            clock += 1
        }
        return saved
    }

    func testTootsAreKeptAcrossRelaunchWithTheirArrangementAndAudio() async throws {
        let first = launch()
        let saved = try await save(["mary", "ode"], in: first)
        XCTAssertTrue(saved.allSatisfy { $0.audioURL.deletingLastPathComponent().standardizedFileURL == store.folder.standardizedFileURL },
                      "The Toots don't play from the store")

        let relaunched = launch()
        XCTAssertEqual(relaunched.toots, saved, "Not the same Toots, oldest first")
        XCTAssertEqual(relaunched.toots.map(\.title), ["Mary Had a Little Lamb", "Ode to Joy"])
        XCTAssertEqual(relaunched.toots[0].arrangement, try XCTUnwrap(relaunched.coverage(of: try XCTUnwrap(relaunched.song("mary"))).matchedArrangement))
        let file = try AVAudioFile(forReading: relaunched.toots[0].audioURL)
        XCTAssertEqual(Double(file.length) / file.fileFormat.sampleRate, relaunched.toots[0].seconds, accuracy: 0.001)
        XCTAssertEqual(relaunched.profileStats.toots, 2)

        relaunched.togglePlayback(of: .toot(relaunched.toots[0].id))
        XCTAssertEqual(relaunched.nowPlaying, .toot(relaunched.toots[0].id))
        relaunched.stopPlayback()
    }

    func testARenameIsKeptAcrossRelaunch() async throws {
        let first = launch()
        let mary = try await save(["mary"], in: first)[0]
        first.renameToot(mary.id, to: "  Lamb Toots ")
        XCTAssertEqual(first.toot(mary.id)?.title, "Lamb Toots")

        let relaunched = launch()
        XCTAssertEqual(relaunched.toot(mary.id)?.title, "Lamb Toots")
        XCTAssertEqual(relaunched.toot(mary.id)?.songID, "mary", "renaming keeps the Song")
        relaunched.renameToot(mary.id, to: "   ")
        XCTAssertEqual(launch().toot(mary.id)?.title, "Lamb Toots", "a blank title changed it")
    }

    func testADeleteIsKeptAcrossRelaunchAndRemovesTheAudio() async throws {
        let first = launch()
        let saved = try await save(["mary", "ode"], in: first)
        first.deleteToot(saved[0].id)
        XCTAssertFalse(FileManager.default.fileExists(atPath: saved[0].audioURL.path(percentEncoded: false)), "The audio is still there")

        let relaunched = launch()
        XCTAssertEqual(relaunched.toots.map(\.id), [saved[1].id])
        XCTAssertNil(relaunched.toot(saved[0].id))
    }

    /// Deleting a Recording a Toot used doesn't break the Toot: it keeps its own audio, and its
    /// Arrangement still names the deleted Recording.
    func testDeletingARecordingTheTootUsedKeepsTheToot() async throws {
        let first = launch()
        let mary = try await save(["mary"], in: first)[0]
        let used = try XCTUnwrap(mary.arrangement.recordingForPitch[74])
        first.delete(used)

        let relaunched = launch()
        let toot = try XCTUnwrap(relaunched.toot(mary.id))
        XCTAssertEqual(toot.arrangement, mary.arrangement)
        XCTAssertFalse(toot.isAudioMissing)
        relaunched.togglePlayback(of: .toot(toot.id))
        XCTAssertEqual(relaunched.nowPlaying, .toot(toot.id))
        relaunched.stopPlayback()
    }

    func testAMissingAudioFileIsReportedAfterRelaunch() async throws {
        let first = launch()
        let mary = try await save(["mary"], in: first)[0]
        try FileManager.default.removeItem(at: mary.audioURL)

        let relaunched = launch()
        XCTAssertEqual(relaunched.toot(mary.id)?.isAudioMissing, true)
        relaunched.togglePlayback(of: .toot(mary.id))
        XCTAssertNil(relaunched.nowPlaying)
        relaunched.deleteToot(mary.id)
        XCTAssertTrue(launch().toots.isEmpty)
    }

    /// Audio left without its details, by a delete that was interrupted, is cleaned up.
    func testLeftoverAudioIsRemoved() async throws {
        try FileManager.default.createDirectory(at: store.folder, withIntermediateDirectories: true)
        let leftover = store.audioURL(of: UUID())
        try Data([0]).write(to: leftover)
        XCTAssertTrue(try store.load().isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: leftover.path(percentEncoded: false)))
    }
}
