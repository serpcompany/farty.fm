/// Pitch Coverage: how many of a Song's distinct pitches are covered, each by its own Melodic
/// Recording close enough to it (see `CONTEXT.md` and `docs/design/app-map.md`).
///
/// The approved rule, ported from the #47 prototype's `fit()`: under the best transposition of
/// the Song, every distinct pitch needs a *different* Melodic Recording within 3 semitones of it.
/// A Song is unlocked when every distinct pitch is covered. #43 validates the thresholds.
enum PitchCoverage {
    /// The furthest a Recording may be shifted to reach a note, in semitones (ADR 0004).
    static let maximumShift = 3.0
    /// The transpositions tried, in semitones, in order. The first that covers the most pitches wins.
    static let transpositions = -36...24

    /// A Song's Pitch Coverage for a set of Recording Pitches.
    struct Match: Hashable, Sendable {
        /// How many of the Song's distinct pitches have their own Recording.
        let covered: Int
        /// How many distinct pitches the Song has.
        let total: Int
        /// The transposition in semitones that covers the most pitches.
        let transposition: Int
        /// The transposed pitches (MIDI note numbers) that no Recording covers, lowest first.
        let missing: [Int]
        /// Indices into the Recording Pitches that cover a pitch, in index order.
        let used: [Int]
        /// For each of the Song's pitches, the index of the Recording Pitch that covers it.
        let coveredBy: [Int?]
    }

    /// Matches Recording Pitches (MIDI note numbers of Melodic Recordings) to a Song's distinct
    /// pitches: one Recording per pitch, within `maximumShift`, under the best transposition.
    ///
    /// Uses maximum bipartite matching (Kuhn's algorithm), trying closer Recordings first.
    static func match(songPitches: [Int], recordingPitches: [Double]) -> Match {
        guard !recordingPitches.isEmpty else {
            return Match(
                covered: 0,
                total: songPitches.count,
                transposition: 0,
                missing: [],
                used: [],
                coveredBy: Array(repeating: nil, count: songPitches.count)
            )
        }

        var best: (covered: Int, transposition: Int, owner: [Int])?
        for transposition in transpositions {
            let candidates = songPitches.map { pitch in
                recordingPitches.indices
                    .map { (index: $0, distance: abs(Double(pitch + transposition) - recordingPitches[$0])) }
                    .filter { $0.distance <= maximumShift }
                    .sorted { ($0.distance, $0.index) < ($1.distance, $1.index) }
                    .map(\.index)
            }
            // owner[recording] is the song pitch index the Recording covers, or -1.
            var owner = Array(repeating: -1, count: recordingPitches.count)
            var covered = 0
            for note in songPitches.indices {
                var seen = Array(repeating: false, count: recordingPitches.count)
                if assign(note, candidates: candidates, owner: &owner, seen: &seen) {
                    covered += 1
                }
            }
            if best == nil || covered > best!.covered {
                best = (covered, transposition, owner)
            }
            if covered == songPitches.count { break }
        }

        let (covered, transposition, owner) = best!
        var coveredBy = [Int?](repeating: nil, count: songPitches.count)
        for recording in owner.indices where owner[recording] >= 0 {
            coveredBy[owner[recording]] = recording
        }
        return Match(
            covered: covered,
            total: songPitches.count,
            transposition: transposition,
            missing: songPitches.indices.filter { coveredBy[$0] == nil }.map { songPitches[$0] + transposition },
            used: owner.indices.filter { owner[$0] >= 0 },
            coveredBy: coveredBy
        )
    }

    /// Tries to give song pitch `note` a Recording, moving earlier assignments along if needed.
    private static func assign(_ note: Int, candidates: [[Int]], owner: inout [Int], seen: inout [Bool]) -> Bool {
        for recording in candidates[note] where !seen[recording] {
            seen[recording] = true
            if owner[recording] < 0 || assign(owner[recording], candidates: candidates, owner: &owner, seen: &seen) {
                owner[recording] = note
                return true
            }
        }
        return false
    }
}

/// A Song's Pitch Coverage by a user's Recordings.
struct CoverageResult: Hashable, Sendable {
    let covered: Int
    let total: Int
    /// The transposition, in semitones, that covers the most pitches.
    let transposition: Int
    /// The transposed pitches still needed, as MIDI note numbers.
    let missing: [Int]
    /// The Melodic Recordings that cover a pitch.
    let used: [Recording.ID]
    /// The Melodic Recording that covers each covered pitch, keyed by the Song's pitch (MIDI, in
    /// the score's key).
    let recordingForPitch: [Int: Recording.ID]
    /// False when there are no Melodic Recordings at all.
    let hasMelodicRecordings: Bool

    /// An Unlocked Song: every distinct pitch has its own Melodic Recording.
    var isUnlocked: Bool { covered == total }

    /// Covered pitches as a fraction, for the Pitch Coverage bar.
    var fraction: Double { total == 0 ? 0 : Double(covered) / Double(total) }

    /// "3 of 4 notes covered", or "All 4 notes covered" when unlocked.
    var summary: String { isUnlocked ? "All \(total) notes covered" : "\(covered) of \(total) notes covered" }

    /// The notes still needed, with their octave: "D3 and F3", or with a `limit` of 3,
    /// "D3, F3, A3, and 2 more". Nil when nothing is missing.
    func missingNotes(limit: Int? = nil) -> String? {
        let names = missing.map { Pitch.name(Double($0)) }
        guard !names.isEmpty else { return nil }
        guard let limit, names.count > limit else { return names.formatted(.list(type: .and)) }
        return (names.prefix(limit) + ["\(names.count - limit) more"]).formatted(.list(type: .and))
    }

    /// Pitch Coverage's matching as an Arrangement: each pitch of an Unlocked Song played by the
    /// Recording that covers it. Nil while the Song is locked. It isn't Auto-map, which picks the
    /// closest Recordings (#17).
    var matchedArrangement: Arrangement? {
        isUnlocked ? Arrangement(recordingForPitch: recordingForPitch, transposition: transposition) : nil
    }
}

extension CoverageResult {
    /// The Pitch Coverage of `song` by the Melodic ones among `recordings`.
    init(song: Song, recordings: [Recording]) {
        let melodic = recordings.filter(\.isMelodic)
        let match = PitchCoverage.match(songPitches: song.pitches, recordingPitches: melodic.compactMap(\.pitch))
        var recordingForPitch: [Int: Recording.ID] = [:]
        for (pitch, recording) in zip(song.pitches, match.coveredBy) {
            if let recording { recordingForPitch[pitch] = melodic[recording].id }
        }
        self.init(
            covered: match.covered,
            total: match.total,
            transposition: match.transposition,
            missing: match.missing,
            used: match.used.map { melodic[$0].id },
            recordingForPitch: recordingForPitch,
            hasMelodicRecordings: !melodic.isEmpty
        )
    }
}

/// Every Song's Pitch Coverage, matched once per change to the Melodic Recordings. Searching,
/// sorting and redrawing read the stored results and never match a Song again.
struct CoverageCache {
    let songs: [Song]
    /// The Melodic Recordings the stored results were matched with; nil before the first match.
    private var melodic: [Recording]?
    /// Every Song with its coverage, in catalog order.
    private var rows: [SongListing.Row] = []
    private var rowOfSong: [Song.ID: Int] = [:]
    /// `rows` sorted each way, once asked for.
    private var sorted: [SongOrder: [SongListing.Row]] = [:]
    /// How many times the whole Song Catalog was matched.
    private(set) var catalogMatches = 0

    init(songs: [Song]) {
        self.songs = songs
    }

    /// A Song's Pitch Coverage by the Melodic ones among `recordings`.
    mutating func coverage(of song: Song, recordings: [Recording]) -> CoverageResult {
        update(recordings)
        if let row = rowOfSong[song.id] { return rows[row].coverage }
        return CoverageResult(song: song, recordings: melodic ?? [])
    }

    /// The Songs matching `query`, in `order`, split into Unlocked and locked Songs.
    mutating func listing(recordings: [Recording], matching query: String, order: SongOrder) -> SongListing {
        update(recordings)
        let ordered = sorted[order] ?? SongListing.sorted(rows, by: order)
        sorted[order] = ordered
        return SongListing(sorted: ordered, matching: query)
    }

    /// Matches every Song again if the Melodic Recordings changed. Checking costs one comparison
    /// per Melodic Recording.
    private mutating func update(_ recordings: [Recording]) {
        let melodic = recordings.filter(\.isMelodic)
        guard melodic != self.melodic else { return }
        self.melodic = melodic
        rows = songs.map { SongListing.Row(song: $0, coverage: CoverageResult(song: $0, recordings: melodic)) }
        catalogMatches += 1
        rowOfSong = Dictionary(rows.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        sorted = [:]
    }
}

/// How the Song Catalog's Pitch Coverage changed when a Recording was added: what the Result
/// screen shows.
struct CoverageChanges: Hashable, Sendable {
    struct Entry: Hashable, Sendable {
        let song: Song
        let coverage: CoverageResult
    }

    /// Songs that just became Unlocked Songs, in catalog order.
    let unlocked: [Song]
    /// Songs still locked that gained a covered pitch, closest to unlocking first.
    let improved: [Entry]
    /// The locked Song closest to unlocking, if any Song is still locked.
    let closest: Entry?

    /// Compares every Song's Pitch Coverage before and after `recordings` changed.
    init(songs: [Song], before: [Recording], after: [Recording]) {
        let old = songs.map { CoverageResult(song: $0, recordings: before) }
        let new = songs.map { CoverageResult(song: $0, recordings: after) }
        let closestFirst: (Entry, Entry) -> Bool = { $0.coverage.fraction > $1.coverage.fraction }

        unlocked = songs.indices.filter { !old[$0].isUnlocked && new[$0].isUnlocked }.map { songs[$0] }
        improved = songs.indices
            .filter { !new[$0].isUnlocked && new[$0].covered > old[$0].covered }
            .map { Entry(song: songs[$0], coverage: new[$0]) }
            .stableSorted(by: closestFirst)
        closest = songs.indices
            .filter { !new[$0].isUnlocked }
            .map { Entry(song: songs[$0], coverage: new[$0]) }
            .stableSorted(by: closestFirst)
            .first
    }
}

private extension Array {
    /// Sorts keeping equal elements in their original order, like JavaScript's `sort`.
    func stableSorted(by areInIncreasingOrder: (Element, Element) -> Bool) -> [Element] {
        enumerated()
            .sorted { areInIncreasingOrder($0.element, $1.element) || (!areInIncreasingOrder($1.element, $0.element) && $0.offset < $1.offset) }
            .map(\.element)
    }
}
