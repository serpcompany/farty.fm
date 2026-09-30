import Foundation

/// A Toot Song Creator made, before it's saved to the Toots tab.
struct TootDraft: Identifiable, Hashable, Sendable {
    /// Saving keeps this id for the Toot.
    let id: UUID
    let song: Song
    let arrangement: Arrangement
    /// Length in seconds.
    let seconds: Double
    let audioURL: URL
}

/// A Toot: a Song played with the user's Recordings, saved from Song Creator (see `CONTEXT.md`).
struct Toot: Identifiable, Hashable, Sendable {
    let id: UUID
    /// The Song's title until the user renames it.
    var title: String
    /// The Song it was made from.
    let songID: Song.ID
    let createdAt: Date
    /// Length in seconds.
    let seconds: Double
    let audioURL: URL
    /// Which Recording played each pitch, kept from when it was made. A Recording deleted later
    /// stays listed here, and the Toot still plays: the audio is its own.
    let arrangement: Arrangement
    /// The audio file was gone or unreadable when the Toot was saved or loaded. Models check it
    /// then, not on every redraw.
    let isAudioMissing: Bool

    /// Whether the file at `url` is gone or can't be read.
    static func isAudioMissing(at url: URL) -> Bool {
        !FileManager.default.isReadableFile(atPath: url.path(percentEncoded: false))
    }
}

/// Why Song Creator couldn't make a Toot.
enum TootError: Error, Hashable, Sendable {
    /// The Song isn't an Unlocked Song.
    case locked
    /// Making it failed, for example a Recording's file is missing.
    case couldNotMake
}

/// Formats a Toot's length the way rows show it: "0:17".
func formattedTootLength(_ seconds: Double) -> String {
    Duration.seconds(seconds.rounded()).formatted(.time(pattern: .minuteSecond))
}
