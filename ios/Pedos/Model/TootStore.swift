import Foundation

/// Saved Toots as plain files, like Recordings (ADR 0002). Each Toot is `<id>.m4a`, its own copy
/// of the rendered audio, with `<id>.json` beside it for its title, Song, date, length and
/// Arrangement. The list is rebuilt by reading the folder. The audio is a copy, so deleting a
/// Recording a Toot used doesn't change how the Toot sounds.
struct TootStore: Sendable {
    /// Where saved Toots live: `Application Support/Toots` in the app.
    let folder: URL

    /// The app's own store.
    static let standard = TootStore(folder: URL.applicationSupportDirectory.appending(path: "Toots", directoryHint: .isDirectory))

    /// A new empty store in the temporary directory, for sample data and tests.
    static func temporary() -> TootStore {
        TootStore(folder: URL.temporaryDirectory.appending(path: "Toots-\(UUID().uuidString)", directoryHint: .isDirectory))
    }

    /// Saves a Toot: copies its audio into the folder, then writes its details. Returns the Toot
    /// as kept, playing its own copy of the audio.
    func save(_ toot: Toot) throws -> Toot {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        let audio = audioURL(of: toot.id)
        try? fileManager.removeItem(at: audio)
        try fileManager.copyItem(at: toot.audioURL, to: audio)
        do {
            try write(Details(toot), of: toot.id)
        } catch {
            try? fileManager.removeItem(at: audio)
            throw error
        }
        return toot.keeping(audioURL: audio)
    }

    /// Every saved Toot, oldest first. Audio without details, which an interrupted save or
    /// delete leaves, is removed. A Toot whose audio is gone is kept, marked `isAudioMissing`.
    func load() throws -> [Toot] {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: folder.path(percentEncoded: false)) else { return [] }
        let files = try fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        var toots: [Toot] = []
        for file in files {
            guard let id = Self.id(of: file) else { continue }
            switch file.pathExtension {
            case "json":
                guard let details = try? JSONDecoder().decode(Details.self, from: Data(contentsOf: file)) else { continue }
                toots.append(details.toot(id: id, audioURL: audioURL(of: id)))
            case "m4a" where !fileManager.fileExists(atPath: detailsURL(of: id).path(percentEncoded: false)):
                try? fileManager.removeItem(at: file)
            default:
                continue
            }
        }
        return toots.sorted { ($0.createdAt, $0.id.uuidString) < ($1.createdAt, $1.id.uuidString) }
    }

    /// Changes a saved Toot's title.
    func rename(_ id: Toot.ID, to title: String) throws {
        var details = try JSONDecoder().decode(Details.self, from: Data(contentsOf: detailsURL(of: id)))
        details.title = title
        try write(details, of: id)
    }

    /// Deletes a saved Toot: its details first, so an interrupted delete leaves only audio,
    /// which `load` removes.
    func delete(_ id: Toot.ID) throws {
        try FileManager.default.removeItem(at: detailsURL(of: id))
        try? FileManager.default.removeItem(at: audioURL(of: id))
    }

    /// Where a saved Toot's own copy of its audio is.
    func audioURL(of id: Toot.ID) -> URL {
        folder.appending(path: "\(id.uuidString).m4a")
    }

    private func detailsURL(of id: Toot.ID) -> URL {
        folder.appending(path: "\(id.uuidString).json")
    }

    private func write(_ details: Details, of id: Toot.ID) throws {
        try JSONEncoder().encode(details).write(to: detailsURL(of: id), options: .atomic)
    }

    /// The Toot a file belongs to: the UUID its name starts with.
    private static func id(of file: URL) -> UUID? {
        file.lastPathComponent.split(separator: ".").first.flatMap { UUID(uuidString: String($0)) }
    }

    /// What `<id>.json` holds.
    private struct Details: Codable {
        var title: String
        let songID: String
        let createdAt: Date
        let seconds: Double
        let transposition: Int
        /// The Recording that played each pitch, keyed by the Song's pitch (MIDI, in the score's
        /// key) as a string.
        let recordingForPitch: [String: UUID]

        init(_ toot: Toot) {
            title = toot.title
            songID = toot.songID
            createdAt = toot.createdAt
            seconds = toot.seconds
            transposition = toot.arrangement.transposition
            recordingForPitch = Dictionary(uniqueKeysWithValues: toot.arrangement.recordingForPitch.map { (String($0.key), $0.value) })
        }

        func toot(id: UUID, audioURL: URL) -> Toot {
            Toot(
                id: id,
                title: title,
                songID: songID,
                createdAt: createdAt,
                seconds: seconds,
                audioURL: audioURL,
                arrangement: Arrangement(
                    recordingForPitch: Dictionary(uniqueKeysWithValues: recordingForPitch.compactMap { key, value in Int(key).map { ($0, value) } }),
                    transposition: transposition
                ),
                isAudioMissing: Toot.isAudioMissing(at: audioURL)
            )
        }
    }
}

extension Toot {
    /// The same Toot, playing the audio at `url`.
    func keeping(audioURL url: URL) -> Toot {
        Toot(id: id, title: title, songID: songID, createdAt: createdAt, seconds: seconds, audioURL: url,
             arrangement: arrangement, isAudioMissing: Toot.isAudioMissing(at: url))
    }
}
