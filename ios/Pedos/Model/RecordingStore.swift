import AVFAudio
import Foundation

/// Saved Recordings as plain files (ADR 0002). Each Recording is `<id>.m4a` in one folder, with
/// `<id>.json` beside it for its number, length and save date. The list is rebuilt by reading
/// that folder. A take is recorded to a draft file in a temporary folder until it is saved or
/// discarded.
///
/// Nothing here depends on Recording Analysis: saving never waits for it.
struct RecordingStore: Sendable {
    /// Where saved Recordings live: `Application Support/Recordings` in the app.
    let folder: URL
    /// Where drafts are recorded before Save or Discard.
    let draftFolder: URL

    /// The app's own store.
    static let standard = RecordingStore(
        folder: URL.applicationSupportDirectory.appending(path: "Recordings", directoryHint: .isDirectory),
        draftFolder: URL.temporaryDirectory
    )

    /// A new file to record a draft into. Nothing is written until the recorder writes it.
    func newDraftURL() -> URL {
        draftFolder.appending(path: "pedos-draft-\(UUID().uuidString).m4a")
    }

    /// Saves a draft: moves its file into `folder` as a new Recording, numbered after the highest
    /// number saved so far (a deleted number is not reused unless it was the highest).
    func save(draftAt draft: URL, seconds: Double, savedAt date: Date = .now) throws -> StoredRecording {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        let id = UUID()
        let details = Details(number: (try load().map(\.number).max() ?? 0) + 1, seconds: seconds, savedAt: date)
        // The details first: if the app dies before the move, `load` drops them as an orphan.
        try write(details, of: id)
        do {
            try fileManager.moveItem(at: draft, to: audioURL(of: id))
        } catch {
            try? fileManager.removeItem(at: detailsURL(of: id))
            throw error
        }
        return recording(id, details)
    }

    /// Deletes a draft that won't be saved. A missing draft is not an error.
    func discard(draftAt draft: URL) {
        try? FileManager.default.removeItem(at: draft)
    }

    /// Deletes a saved Recording's audio and details.
    func delete(_ id: StoredRecording.ID) throws {
        let fileManager = FileManager.default
        try fileManager.removeItem(at: audioURL(of: id))
        try? fileManager.removeItem(at: detailsURL(of: id))
    }

    /// Every saved Recording, oldest (lowest number) first. An audio file without details, which
    /// only an interrupted save or a hand-copied file leaves, gets the next number and its own
    /// length; details without audio are removed.
    func load() throws -> [StoredRecording] {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: folder.path(percentEncoded: false)) else { return [] }
        let files = try fileManager.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: [.creationDateKey], options: [.skipsHiddenFiles]
        )
        let audioIDs = Set(files.filter { $0.pathExtension == "m4a" }.compactMap(Self.id(of:)))

        var recordings: [StoredRecording] = []
        for file in files where file.pathExtension == "json" {
            guard let id = Self.id(of: file) else { continue }
            guard audioIDs.contains(id) else {
                try? fileManager.removeItem(at: file)
                continue
            }
            if let details = try? JSONDecoder.recordings.decode(Details.self, from: Data(contentsOf: file)) {
                recordings.append(recording(id, details))
            }
        }

        let described = Set(recordings.map(\.id))
        for id in audioIDs.subtracting(described).sorted(by: { $0.uuidString < $1.uuidString }) {
            let audio = audioURL(of: id)
            guard let file = try? AVAudioFile(forReading: audio), file.fileFormat.sampleRate > 0 else { continue }
            let savedAt = (try? audio.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .now
            let details = Details(
                number: (recordings.map(\.number).max() ?? 0) + 1,
                seconds: Double(file.length) / file.fileFormat.sampleRate,
                savedAt: savedAt
            )
            try? write(details, of: id)
            recordings.append(recording(id, details))
        }
        return recordings.sorted { $0.number < $1.number }
    }

    private func recording(_ id: UUID, _ details: Details) -> StoredRecording {
        StoredRecording(
            id: id, number: details.number, seconds: details.seconds, savedAt: details.savedAt,
            audioURL: audioURL(of: id)
        )
    }

    private func write(_ details: Details, of id: UUID) throws {
        try JSONEncoder.recordings.encode(details).write(to: detailsURL(of: id), options: .atomic)
    }

    private func audioURL(of id: StoredRecording.ID) -> URL {
        folder.appending(path: "\(id.uuidString).m4a")
    }

    private func detailsURL(of id: StoredRecording.ID) -> URL {
        folder.appending(path: "\(id.uuidString).json")
    }

    private static func id(of file: URL) -> UUID? {
        UUID(uuidString: file.deletingPathExtension().lastPathComponent)
    }
}

/// A Recording as the store keeps it: its audio file and the details the list shows.
struct StoredRecording: Identifiable, Hashable, Sendable {
    let id: UUID
    /// "Recording 1, 2, …" (see `Recording.number`).
    let number: Int
    /// Length in seconds.
    let seconds: Double
    let savedAt: Date
    let audioURL: URL
}

/// What `<id>.json` holds. Recording Analysis results go beside these later (#14).
private struct Details: Codable {
    let number: Int
    let seconds: Double
    let savedAt: Date
}

private extension JSONEncoder {
    static var recordings: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970 // Exact, so a reload equals what was saved.
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}

private extension JSONDecoder {
    static var recordings: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return decoder
    }
}
