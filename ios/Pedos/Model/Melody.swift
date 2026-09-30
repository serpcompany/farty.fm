import Foundation

/// A melody Song Creator made from a Song, before it's saved to Melodies.
struct MelodyDraft: Identifiable, Hashable, Sendable {
    /// Saving keeps this id for the Created Melody.
    let id: UUID
    let song: Song
    let arrangement: Arrangement
    /// Length in seconds.
    let seconds: Double
    let audioURL: URL
}

/// A playable fart-only melody the user made with Song Creator (see `CONTEXT.md`).
struct CreatedMelody: Identifiable, Hashable, Sendable {
    let id: UUID
    /// The Song's title until the user renames it.
    var title: String
    /// Where it came from: the Song's title.
    let origin: String
    let createdAt: Date
    /// Length in seconds.
    let seconds: Double
    let audioURL: URL

    /// True when the audio file is gone or can't be read.
    var isAudioMissing: Bool {
        !FileManager.default.isReadableFile(atPath: audioURL.path(percentEncoded: false))
    }
}

/// Why Song Creator couldn't make a melody.
enum MelodyError: Error, Hashable, Sendable {
    /// The Song isn't an Unlocked Song.
    case locked
    /// Making it failed, for example a Recording's file is missing.
    case couldNotMake
}

/// Formats a melody's length the way rows show it: "0:17".
func formattedMelodyLength(_ seconds: Double) -> String {
    Duration.seconds(seconds.rounded()).formatted(.time(pattern: .minuteSecond))
}
