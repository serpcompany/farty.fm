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
    ///   - rows: Songs with their Pitch Coverage, already in the order to show (`sorted(_:by:)`).
    ///   - query: matches anywhere in the title, ignoring case and accents; empty matches all.
    init(sorted rows: [Row], matching query: String) {
        let query = query.trimmingCharacters(in: .whitespaces)
        let rows = query.isEmpty ? rows : rows.filter { $0.song.title.localizedStandardContains(query) }
        unlocked = rows.filter(\.coverage.isUnlocked)
        locked = rows.filter { !$0.coverage.isUnlocked }
    }

    /// Sorts and filters `rows`, given in catalog order.
    init(_ rows: [Row], matching query: String, order: SongOrder) {
        self.init(sorted: Self.sorted(rows, by: order), matching: query)
    }

    /// `rows`, given in catalog order, sorted by `order`. Ties keep catalog order.
    static func sorted(_ rows: [Row], by order: SongOrder) -> [Row] {
        switch order {
        case .closestToUnlocking:
            rows.enumerated().sorted { a, b in
                let (x, y) = (a.element.coverage, b.element.coverage)
                if x.fraction != y.fraction { return x.fraction > y.fraction }
                if x.total != y.total { return x.total < y.total }
                return a.offset < b.offset
            }.map(\.element)
        case .alphabetical:
            rows.enumerated().sorted { a, b in
                switch a.element.song.title.localizedStandardCompare(b.element.song.title) {
                case .orderedAscending: true
                case .orderedDescending: false
                case .orderedSame: a.offset < b.offset
                }
            }.map(\.element)
        }
    }
}
