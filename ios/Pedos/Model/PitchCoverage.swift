import Foundation
import RecordingAnalysisKit

/// A Song's Pitch Coverage by a user's Recordings, and the Arrangement Auto-map chose: each
/// distinct pitch gets its own Melodic Recording within 3 semitones, or an octave away with an
/// Octave Move where the Song needs it (ADR 0004, ADR 0006). It comes from
/// `RecordingAnalysisKit.AutoMap`, the reference engine's `melody_fit()` in Swift.
struct CoverageResult: Hashable, Sendable {
    let covered: Int
    let total: Int
    /// The transposition, in semitones, Auto-map chose.
    let transposition: Int
    /// The transposed pitches still needed, as MIDI note numbers, lowest first.
    let missing: [Int]
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

    /// Auto-map's Arrangement of an Unlocked Song: the Recording that plays each pitch, and the
    /// transposition. Nil while the Song is locked.
    var matchedArrangement: Arrangement? {
        isUnlocked ? Arrangement(recordingForPitch: recordingForPitch, transposition: transposition) : nil
    }
}

extension CoverageResult {
    /// Auto-map of `song` with the Melodic ones among `recordings`. Ties between equally good
    /// Arrangements break on each Recording's `uuidString`.
    init(song: Song, recordings: [Recording]) {
        let melodic = recordings.compactMap(AutoMapInput.init)
        let idOf = Dictionary(melodic.map { ($0.input.id, $0.id) }, uniquingKeysWith: { first, _ in first })
        let result = AutoMap.arrange(song.autoMapSong, recordings: melodic.map(\.input))
        var recordingForPitch: [Int: Recording.ID] = [:]
        for choice in result.pitches {
            if let id = choice.recordingID.flatMap({ idOf[$0] }) { recordingForPitch[choice.songPitch] = id }
        }
        self.init(
            covered: result.covered,
            total: result.total,
            transposition: result.transposition,
            // Without a Melodic Recording, no transposition is better than another.
            missing: melodic.isEmpty ? [] : result.missingNotes,
            recordingForPitch: recordingForPitch,
            hasMelodicRecordings: !melodic.isEmpty
        )
    }
}

/// A Melodic Recording as Auto-map reads it.
private struct AutoMapInput {
    let id: Recording.ID
    let input: AutoMap.Recording

    init?(_ recording: Recording) {
        guard case .analyzed(let analysis) = recording.analysis, let pitch = analysis.pitch,
              let shortestNote = analysis.shortestNoteSeconds
        else { return nil }
        // The gesture's length in whole samples, as the reference measures it.
        let sampleRate = Double(Renderer.sampleRate)
        let end = analysis.endSeconds ?? recording.seconds
        let samples = (end * sampleRate).rounded() - (analysis.startSeconds * sampleRate).rounded()
        id = recording.id
        input = AutoMap.Recording(
            id: recording.id.uuidString,
            recordingPitchMIDI: pitch,
            shortestNoteSeconds: shortestNote,
            gestureSeconds: samples / sampleRate
        )
    }
}

extension Song {
    /// The Song as Auto-map reads it: its tempo and each note's pitch and length.
    var autoMapSong: AutoMap.Song {
        AutoMap.Song(bpm: Double(bpm), notes: notes.map { AutoMap.Song.Note(pitch: $0.pitch, lengthBeats: $0.length) })
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
