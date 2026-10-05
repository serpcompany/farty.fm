import XCTest
@testable import Pedos

/// The Recording store against a temporary folder, never the app's own Recordings.
final class RecordingStoreTests: XCTestCase {
    private var root: URL!
    private var store: RecordingStore!

    override func setUpWithError() throws {
        root = URL.temporaryDirectory.appending(path: "RecordingStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        store = RecordingStore(
            folder: root.appending(path: "Recordings", directoryHint: .isDirectory),
            draftFolder: root.appending(path: "Drafts", directoryHint: .isDirectory)
        )
        try FileManager.default.createDirectory(at: store.draftFolder, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    /// A draft as the recorder leaves it; the store never decodes it.
    private func makeDraft(_ contents: String = "take") throws -> URL {
        let url = store.newDraftURL()
        try Data(contents.utf8).write(to: url)
        return url
    }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
    }

    func testAnEmptyStoreHasNoRecordings() throws {
        XCTAssertEqual(try store.load(), [])
    }

    func testDraftsAreRecordedInTheDraftFolder() {
        let draft = store.newDraftURL()
        XCTAssertEqual(draft.deletingLastPathComponent().standardizedFileURL, store.draftFolder.standardizedFileURL)
        XCTAssertEqual(draft.pathExtension, "m4a")
        XCTAssertNotEqual(draft, store.newDraftURL())
    }

    func testSaveMovesTheDraftIntoTheFolderAsRecording1() throws {
        let draft = try makeDraft("first take")
        let saved = try store.save(draftAt: draft, seconds: 1.4)

        XCTAssertFalse(exists(draft), "The draft is moved, not copied")
        XCTAssertEqual(saved.number, 1)
        XCTAssertEqual(saved.seconds, 1.4)
        XCTAssertEqual(saved.audioURL.lastPathComponent, "\(saved.id.uuidString).m4a")
        XCTAssertEqual(saved.audioURL.deletingLastPathComponent().standardizedFileURL, store.folder.standardizedFileURL)
        XCTAssertEqual(try Data(contentsOf: saved.audioURL), Data("first take".utf8))
        XCTAssertEqual(try store.load().map(\.id), [saved.id])
    }

    func testDiscardDeletesTheDraftAndSavesNothing() throws {
        let draft = try makeDraft()
        store.discard(draftAt: draft)
        XCTAssertFalse(exists(draft))
        XCTAssertEqual(try store.load(), [])
        store.discard(draftAt: draft) // Discarding again is harmless.
    }

    func testDeleteRemovesTheRecordingAndItsDetails() throws {
        let kept = try store.save(draftAt: try makeDraft(), seconds: 1)
        let deleted = try store.save(draftAt: try makeDraft(), seconds: 2)

        try store.delete(deleted.id)

        XCTAssertFalse(exists(deleted.audioURL))
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: store.folder.path(percentEncoded: false))
        XCTAssertFalse(leftovers.contains { $0.hasPrefix(deleted.id.uuidString) }, "Left behind: \(leftovers)")
        XCTAssertEqual(try store.load().map(\.id), [kept.id])
    }

    func testRecordingsSurviveARelaunch() throws {
        // Saved now, to the sub-millisecond, so the dates must survive the round trip exactly.
        let first = try store.save(draftAt: try makeDraft(), seconds: 0.8)
        let second = try store.save(draftAt: try makeDraft(), seconds: 1.9)

        // A relaunch: a new store on the same folder, with the drafts folder emptied.
        try FileManager.default.removeItem(at: store.draftFolder)
        let relaunched = RecordingStore(folder: store.folder, draftFolder: store.draftFolder)

        XCTAssertEqual(try relaunched.load(), [first, second])
    }

    func testNumbersContinueFromTheHighest() throws {
        let one = try store.save(draftAt: try makeDraft(), seconds: 1)
        let two = try store.save(draftAt: try makeDraft(), seconds: 1)
        let three = try store.save(draftAt: try makeDraft(), seconds: 1)

        try store.delete(two.id)
        XCTAssertEqual(try store.save(draftAt: try makeDraft(), seconds: 1).number, 4)
        XCTAssertEqual(try store.load().map(\.number), [1, 3, 4])
        XCTAssertEqual(try store.load().first?.id, one.id)
        XCTAssertEqual(try store.load()[1].id, three.id)
    }

    func testAFailedSaveLeavesNothingBehind() throws {
        let missing = store.newDraftURL() // Never written, so the move fails.
        XCTAssertThrowsError(try store.save(draftAt: missing, seconds: 1))
        XCTAssertEqual(try store.load(), [])
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: store.folder.path(percentEncoded: false))
        XCTAssertEqual(leftovers, [], "A failed save leaves no details behind")
    }

    func testDetailsWithoutAudioAreDropped() throws {
        let saved = try store.save(draftAt: try makeDraft(), seconds: 1)
        try FileManager.default.removeItem(at: saved.audioURL)

        XCTAssertEqual(try store.load(), [])
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: store.folder.path(percentEncoded: false))
        XCTAssertEqual(leftovers, [])
    }
}
