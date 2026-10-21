import Foundation

/// Saved Recordings as plain files (ADR 0002). Each Recording is `<id>.m4a` in one folder, with
/// `<id>.json` beside it for its number, length and save date, and `<id>.analysis.json` once
/// Recording Analysis has run. The list is rebuilt by reading that folder. A take is recorded to
/// a draft file in a temporary folder until it is saved or discarded.
///
/// Saving never waits for Recording Analysis.
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
    /// `fixtureID` marks a Recording loaded from the Fixture Library (internal builds), which
    /// passes its own `id`.
    func save(
        draftAt draft: URL, seconds: Double, savedAt date: Date = .now, id: UUID = UUID(), fixtureID: String? = nil
    ) throws -> StoredRecording {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        let details = Details(
            number: (try load().map(\.number).max() ?? 0) + 1, seconds: seconds, savedAt: date, fixtureID: fixtureID
        )
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

    /// Deletes a saved Recording's audio, details and analysis.
    func delete(_ id: StoredRecording.ID) throws {
        let fileManager = FileManager.default
        try fileManager.removeItem(at: audioURL(of: id))
        try? fileManager.removeItem(at: detailsURL(of: id))
        try? fileManager.removeItem(at: analysisURL(of: id))
    }

    /// Keeps a Recording's analysis next to it.
    func saveAnalysis<Analysis: Encodable>(_ analysis: Analysis, of id: StoredRecording.ID) throws {
        try JSONEncoder().encode(analysis).write(to: analysisURL(of: id), options: .atomic)
    }

    /// A Recording's kept analysis, or nil when there is none or it can't be read as `type`.
    func analysis<Analysis: Decodable>(of id: StoredRecording.ID, as type: Analysis.Type) -> Analysis? {
        guard let data = try? Data(contentsOf: analysisURL(of: id)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// Every saved Recording, oldest (lowest number) first. Details or analysis without audio,
    /// which an interrupted save or delete leaves, are removed.
    func load() throws -> [StoredRecording] {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: folder.path(percentEncoded: false)) else { return [] }
        let files = try fileManager.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]
        )
        let audioIDs = Set(files.filter { $0.pathExtension == "m4a" }.compactMap(Self.id(of:)))

        var recordings: [StoredRecording] = []
        for file in files where file.pathExtension == "json" {
            guard let id = Self.id(of: file) else { continue }
            guard audioIDs.contains(id) else {
                try? fileManager.removeItem(at: file)
                continue
            }
            guard file.lastPathComponent == detailsURL(of: id).lastPathComponent else { continue }
            if let details = try? JSONDecoder().decode(Details.self, from: Data(contentsOf: file)) {
                recordings.append(recording(id, details))
            }
        }

        return recordings.sorted { $0.number < $1.number }
    }

    private func recording(_ id: UUID, _ details: Details) -> StoredRecording {
        StoredRecording(
            id: id, number: details.number, seconds: details.seconds, savedAt: details.savedAt,
            audioURL: audioURL(of: id), fixtureID: details.fixtureID
        )
    }

    private func write(_ details: Details, of id: UUID) throws {
        try JSONEncoder().encode(details).write(to: detailsURL(of: id), options: .atomic)
    }

    private func audioURL(of id: StoredRecording.ID) -> URL {
        folder.appending(path: "\(id.uuidString).m4a")
    }

    private func detailsURL(of id: StoredRecording.ID) -> URL {
        folder.appending(path: "\(id.uuidString).json")
    }

    private func analysisURL(of id: StoredRecording.ID) -> URL {
        folder.appending(path: "\(id.uuidString).analysis.json")
    }

    /// The Recording a file belongs to: the UUID its name starts with.
    private static func id(of file: URL) -> UUID? {
        file.lastPathComponent.split(separator: ".").first.flatMap { UUID(uuidString: String($0)) }
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
    /// The Fixture Library Recording this was loaded from (internal builds), or nil for a real one.
    var fixtureID: String? = nil
}

/// What `<id>.json` holds.
private struct Details: Codable {
    let number: Int
    let seconds: Double
    let savedAt: Date
    var fixtureID: String? = nil
}
