import Foundation

/// How the Compose tab orders Songs within each section.
enum SongOrder: Hashable, Sendable, CaseIterable {
    /// Highest Pitch Coverage first; among equals, Songs with fewer notes first.
    case closestToUnlocking
    case alphabetical
}

/// The Compose tab's Songs, filtered by a search and split into Unlocked and locked Songs.
struct SongListing: Hashable, Sendable {
    struct Row: Identifiable, Hashable, Sendable {
        let song: Song
        let coverage: CoverageResult
        var id: Song.ID { song.id }
    }

    let unlocked: [Row]
    let locked: [Row]

    var isEmpty: Bool { unlocked.isEmpty && locked.isEmpty }

    /// - Parameters:
    ///   - rows: every Song with its Pitch Coverage, in catalog order.
    ///   - query: matches anywhere in the title, ignoring case and accents; empty matches all.
    init(_ rows: [Row], matching query: String, order: SongOrder) {
        let query = query.trimmingCharacters(in: .whitespaces)
        var rows = query.isEmpty ? rows : rows.filter { $0.song.title.localizedStandardContains(query) }
        switch order {
        case .closestToUnlocking:
            // Sorting the catalog order stably keeps ties in catalog order.
            rows = rows.enumerated().sorted { a, b in
                let (x, y) = (a.element.coverage, b.element.coverage)
                if x.fraction != y.fraction { return x.fraction > y.fraction }
                if x.total != y.total { return x.total < y.total }
                return a.offset < b.offset
            }.map(\.element)
        case .alphabetical:
            rows.sort { $0.song.title.localizedStandardCompare($1.song.title) == .orderedAscending }
        }
        unlocked = rows.filter(\.coverage.isUnlocked)
        locked = rows.filter { !$0.coverage.isUnlocked }
    }
}

extension AppModel {
    /// The Song Catalog as the Compose tab lists it.
    func songListing(matching query: String, order: SongOrder) -> SongListing {
        SongListing(songs.map { SongListing.Row(song: $0, coverage: coverage(of: $0)) }, matching: query, order: order)
    }
}
