import Foundation

/// What the Profile tab counts, from what's on the phone.
struct ProfileStats: Hashable, Sendable {
    /// Every saved Recording.
    let recordings: Int
    /// The Melodic Recordings among them.
    let melodicRecordings: Int
    /// The distinct notes the Melodic Recordings sound, octave included (G2 and G3 are two notes),
    /// as on the Recordings tab.
    let notesCollected: Int
    /// Unlocked Songs: Songs whose Pitch Coverage is complete.
    let unlockedSongs: Int
    /// Every Song in the Song Catalog.
    let songs: Int
    /// Every saved Toot.
    let toots: Int
}

extension AppModel {
    /// The Profile tab's counts. Unlocked Songs come from the Compose tab's listing, so they
    /// follow the same Pitch Coverage and don't match the Song Catalog again.
    var profileStats: ProfileStats {
        ProfileStats(
            recordings: recordings.count,
            melodicRecordings: melodicRecordings.count,
            notesCollected: collectedNotes.count,
            unlockedSongs: songListing(matching: "", order: .closestToUnlocking).unlocked.count,
            songs: songs.count,
            toots: toots.count
        )
    }
}

extension Bundle {
    /// The app version for the Profile tab: "0.1.0 (1)", the version and its build number.
    var appVersion: String {
        Self.appVersion(info: infoDictionary ?? [:])
    }

    static func appVersion(info: [String: Any]) -> String {
        let version = info["CFBundleShortVersionString"] as? String ?? "Unknown"
        guard let build = info["CFBundleVersion"] as? String else { return version }
        return "\(version) (\(build))"
    }
}
