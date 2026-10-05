import Foundation

/// Auto-map and Pitch Coverage: a port of the reference engine's `melody_fit()`
/// (`tools/melody-lab/engine.py`), the unlock rule of ADR 0004 and ADR 0006.
///
/// Each distinct Song pitch gets its own Melodic Recording (one to one, never reused), shifted
/// at most 3 semitones, or with an Octave Move (12 semitones up or down, plus at most 3) where
/// the Song needs it. Every transposition from −36 to +24 is tried. Arrangements rank by:
/// 1. the most pitches covered (Pitch Coverage);
/// 2. the fewest Octave Moves;
/// 3. the lowest cost, where costs within `tie` are equal;
/// 4. the Recording ids read in ascending Song pitch order, lexicographically smallest, with an
///    uncovered pitch after every id; then the lower transposition.
///
/// A Song is unlocked when every distinct pitch is covered. Note length changes the cost, never
/// whether a Song unlocks.
public enum AutoMap {
    /// The furthest a Recording may be moved from its Recording Pitch, or from the same note an
    /// octave away, in semitones.
    public static let maximumShift = 3.0
    static let octave = 12.0
    /// Cost per beat of an Octave Move, on top of the remaining shift: more than any real-pitch
    /// move (3^1.5 = 5.2).
    static let octaveMoveCost = 6.0
    /// Cost of a note that sounds too briefly for its Recording to settle on its pitch ...
    static let tooShortCost = 8.0
    /// ... plus this per second it falls short.
    static let tooShortCostPerSecond = 400.0
    /// Silence before the next note: a note sounds for its length minus this.
    static let gapSeconds = 0.025
    /// Arrangement costs this close are equal.
    static let tie = 1e-9
    /// The transpositions tried, in semitones.
    public static let transpositions = -36...24

    /// A Recording as Auto-map sees it. Only Melodic Recordings can play a pitch.
    public struct Recording: Hashable, Sendable {
        /// Ties between equally good Arrangements break on these ids (byte order of UTF-8).
        public var id: String
        /// The Recording Pitch in MIDI; nil for a Noise-like Recording.
        public var recordingPitchMIDI: Double?
        /// The shortest note the Recording plays on pitch, in seconds; nil for a Noise-like
        /// Recording.
        public var shortestNoteSeconds: Double?
        /// The length of the Recording's single clean gesture, in seconds.
        public var gestureSeconds: Double

        public init(id: String, recordingPitchMIDI: Double?, shortestNoteSeconds: Double?, gestureSeconds: Double) {
            self.id = id
            self.recordingPitchMIDI = recordingPitchMIDI
            self.shortestNoteSeconds = shortestNoteSeconds
            self.gestureSeconds = gestureSeconds
        }

        /// From a Recording's stored analysis. The gesture length is recovered in whole samples,
        /// as the reference measures it.
        public init(id: String, analysis: RecordingAnalysis) {
            let sr = Double(analysisSampleRate)
            let samples = (analysis.gestureEndSeconds * sr).rounded() - (analysis.gestureStartSeconds * sr).rounded()
            self.init(id: id, recordingPitchMIDI: analysis.recordingPitchMIDI,
                      shortestNoteSeconds: analysis.shortestNoteSeconds, gestureSeconds: samples / sr)
        }

        var isMelodic: Bool { recordingPitchMIDI != nil && shortestNoteSeconds != nil }
    }

    /// A Song's melody: its tempo and its notes in order.
    public struct Song: Hashable, Sendable {
        public struct Note: Hashable, Sendable {
            /// MIDI note number, before transposition.
            public var pitch: Int
            /// The note's written length in beats.
            public var lengthBeats: Double

            public init(pitch: Int, lengthBeats: Double) {
                self.pitch = pitch
                self.lengthBeats = lengthBeats
            }
        }

        public var bpm: Double
        public var notes: [Note]

        public init(bpm: Double, notes: [Note]) {
            self.bpm = bpm
            self.notes = notes
        }
    }

    /// Which Recording plays one distinct Song pitch.
    public struct PitchChoice: Hashable, Sendable {
        /// The Song's pitch, before transposition.
        public var songPitch: Int
        /// The note to play: `songPitch` plus the transposition.
        public var targetMIDI: Int
        /// The Recording that plays every note at this pitch; nil when none covers it.
        public var recordingID: String?
        /// Target minus Recording Pitch, in semitones; nil when uncovered.
        public var shiftSemitones: Double?
        /// The Recording plays an octave from its Recording Pitch (resampled 12 ± 3 semitones).
        public var isOctaveMove: Bool
    }

    /// Auto-map's answer for one Song: Pitch Coverage, and the Arrangement of the pitches it
    /// covers. A locked Song keeps its partial Arrangement, so `missingNotes` can say which
    /// notes would unlock it.
    public struct Result: Hashable, Sendable {
        /// The transposition in semitones.
        public var transposition: Int
        /// One entry per distinct Song pitch, lowest first.
        public var pitches: [PitchChoice]
        /// How many pitches use an Octave Move.
        public var octaveMoves: Int
        /// The Arrangement's cost, summed over covered pitches in ascending pitch order.
        public var cost: Double

        /// Pitch Coverage: how many distinct pitches have their own Recording ("3 of 4 notes
        /// covered").
        public var covered: Int { pitches.count(where: { $0.recordingID != nil }) }
        public var total: Int { pitches.count }
        /// Every distinct pitch has its own Recording, so the Song can be played.
        public var isUnlocked: Bool { covered == total }
        /// The notes (MIDI, after transposition) that no Recording covers, lowest first.
        public var missingNotes: [Int] { pitches.filter { $0.recordingID == nil }.map(\.targetMIDI) }

        /// The choice for a Song pitch (before transposition).
        public func choice(forSongPitch pitch: Int) -> PitchChoice? {
            pitches.first { $0.songPitch == pitch }
        }
    }

    /// Chooses the transposition and a Recording for each distinct pitch of `song`.
    ///
    /// Synchronous and CPU-bound. Noise-like Recordings are ignored. The answer doesn't depend
    /// on the order of `recordings`.
    public static func arrange(_ song: Song, recordings: [Recording]) -> Result {
        let melodic = recordings.filter(\.isMelodic).sorted { idPrecedes($0.id, $1.id) }
        let pitches = Array(Set(song.notes.map(\.pitch))).sorted()
        let secondsPerBeat = 60 / song.bpm
        var weight: [Double] = []
        var noteSeconds: [[Double]] = []
        for p in pitches {
            var w = 0.0
            var seconds: [Double] = []
            for note in song.notes where note.pitch == p {
                w += note.lengthBeats
                seconds.append(note.lengthBeats * secondsPerBeat - gapSeconds)
            }
            weight.append(w)
            noteSeconds.append(seconds)
        }

        let tables = transpositions.map { t in
            Table(pitches: pitches, recordings: melodic, transposition: t, weight: weight, noteSeconds: noteSeconds)
        }
        let best = tables.map { $0.solve(fixed: []).key }
        let top = best.map(\.rank).min { $0.uncovered != $1.uncovered ? $0.uncovered < $1.uncovered : $0.octaves < $1.octaves }!
        let low = best.filter { $0.rank == top }.map(\.cost).min()!
        let isOptimal = { (k: Key) in k.rank == top && k.cost <= low + tie }

        var winner: (ids: [String?], index: Int, choice: [Int?])?
        for (index, table) in tables.enumerated() where isOptimal(best[index]) {
            let choice = table.smallestIDs(isOptimal: isOptimal)
            let ids = choice.map { $0.map { melodic[$0].id } }
            // Transpositions are visited in ascending order, so on equal ids the lower one stays.
            if winner == nil || idsPrecede(ids, winner!.ids) {
                winner = (ids, index, choice)
            }
        }
        let (_, index, choice) = winner!
        let table = tables[index]
        let t = transpositions.lowerBound + index
        let key = table.key(choice)
        let picked = pitches.indices.map { i in
            guard let j = choice[i] else {
                return PitchChoice(songPitch: pitches[i], targetMIDI: pitches[i] + t, recordingID: nil,
                                   shiftSemitones: nil, isOctaveMove: false)
            }
            return PitchChoice(songPitch: pitches[i], targetMIDI: pitches[i] + t, recordingID: melodic[j].id,
                               shiftSemitones: Double(pitches[i] + t) - melodic[j].recordingPitchMIDI!,
                               isOctaveMove: table.isOctaveMove[i * table.columns + j])
        }
        return Result(transposition: t, pitches: picked, octaveMoves: key.octaves, cost: key.cost)
    }

    /// Cost per beat of playing a note `shift` semitones from the Recording Pitch, and whether
    /// that is an Octave Move; nil when the unlock rule doesn't allow it. Octave Moves go up or
    /// down on equal terms (ADR 0006).
    static func moveCost(shift: Double) -> (cost: Double, isOctaveMove: Bool)? {
        let a = abs(shift)
        if a <= maximumShift { return (pow(a, 1.5), false) }
        if abs(a - octave) <= maximumShift { return (octaveMoveCost + pow(abs(a - octave), 1.5), true) }
        return nil
    }

    /// Cost of the notes a Recording plays too briefly to settle on its pitch. A note sounds for
    /// its own length (minus the gap) or for the Recording's length after resampling by `shift`,
    /// whichever is shorter: an Octave Move up halves a Recording's length. Below the
    /// Recording's shortest note, each note costs `tooShortCost` plus `tooShortCostPerSecond`
    /// per second it falls short.
    static func tooShortCost(noteSeconds: [Double], recordingSeconds: Double, shortestNoteSeconds: Double, shift: Double) -> Double {
        let played = recordingSeconds * pow(2, -shift / 12)
        var cost = 0.0
        for a in noteSeconds {
            let sounds = min(a, played)
            if sounds < shortestNoteSeconds {
                cost += tooShortCost + tooShortCostPerSecond * (shortestNoteSeconds - sounds)
            }
        }
        return cost
    }

    /// Ids compare by their UTF-8 bytes, the same order as the reference's code points.
    static func idPrecedes(_ a: String, _ b: String) -> Bool {
        a.utf8.lexicographicallyPrecedes(b.utf8)
    }

    /// Lexicographic order of per-pitch Recording ids, an uncovered pitch after every id.
    static func idsPrecede(_ a: [String?], _ b: [String?]) -> Bool {
        for (x, y) in zip(a, b) where x != y {
            guard let x else { return false }
            guard let y else { return true }
            return idPrecedes(x, y)
        }
        return a.count < b.count
    }

    /// (uncovered pitches, Octave Moves, cost), compared in that order.
    struct Key {
        var uncovered: Int
        var octaves: Int
        var cost: Double
        var rank: Rank { Rank(uncovered: uncovered, octaves: octaves) }
    }

    struct Rank: Equatable {
        var uncovered: Int
        var octaves: Int
    }

    /// The allowed moves and their costs under one transposition: cell (pitch i, Recording j).
    struct Table {
        let rows: Int
        let columns: Int
        let allowed: [Bool]
        let isOctaveMove: [Bool]
        let cost: [Double]

        init(pitches: [Int], recordings: [Recording], transposition t: Int, weight: [Double], noteSeconds: [[Double]]) {
            rows = pitches.count
            columns = recordings.count
            var allowed = [Bool](repeating: false, count: rows * columns)
            var isOctaveMove = allowed
            var cost = [Double](repeating: 0, count: rows * columns)
            for (i, p) in pitches.enumerated() {
                for (j, r) in recordings.enumerated() {
                    let shift = Double(p + t) - r.recordingPitchMIDI!
                    guard let move = AutoMap.moveCost(shift: shift) else { continue }
                    allowed[i * columns + j] = true
                    isOctaveMove[i * columns + j] = move.isOctaveMove
                    cost[i * columns + j] = weight[i] * move.cost
                        + AutoMap.tooShortCost(noteSeconds: noteSeconds[i], recordingSeconds: r.gestureSeconds,
                                               shortestNoteSeconds: r.shortestNoteSeconds!, shift: shift)
                }
            }
            self.allowed = allowed
            self.isOctaveMove = isOctaveMove
            self.cost = cost
        }

        /// The exact key of a choice, cost summed in pitch order.
        func key(_ choice: [Int?]) -> Key {
            var key = Key(uncovered: 0, octaves: 0, cost: 0)
            for (i, j) in choice.enumerated() {
                guard let j else {
                    key.uncovered += 1
                    continue
                }
                if isOctaveMove[i * columns + j] { key.octaves += 1 }
                key.cost += cost[i * columns + j]
            }
            return key
        }

        /// The best choice for the pitches after `fixed` (Recording indexes or nil, in pitch
        /// order), as one assignment problem. Penalties larger than any cost make it minimise
        /// uncovered pitches first, then Octave Moves, then cost.
        func solve(fixed: [Int?]) -> (key: Key, choice: [Int?]) {
            let first = fixed.count
            let free = (0..<columns).filter { j in !fixed.contains(j) }
            var bound = 0.0
            for i in first..<rows {
                var rowMax = 0.0
                var any = false
                for j in 0..<columns where allowed[i * columns + j] {
                    rowMax = any ? max(rowMax, cost[i * columns + j]) : cost[i * columns + j]
                    any = true
                }
                bound += rowMax
            }
            let octavePenalty = 1 + bound
            let n = rows - first
            let uncoveredPenalty = Double(n + 1) * octavePenalty
            let m = free.count + n
            var matrix = [Double](repeating: .infinity, count: n * m)
            for r in 0..<n {
                let i = first + r
                for (k, j) in free.enumerated() where allowed[i * columns + j] {
                    matrix[r * m + k] = cost[i * columns + j] + (isOctaveMove[i * columns + j] ? octavePenalty : 0)
                }
                matrix[r * m + free.count + r] = uncoveredPenalty  // this pitch stays uncovered
            }
            var choice = fixed
            if n > 0 {
                for k in Assignment.minimumCost(matrix, rows: n, columns: m) {
                    choice.append(k < free.count ? free[k] : nil)
                }
            }
            return (key(choice), choice)
        }

        /// The lexicographically smallest optimal choice by Recording id (Recordings are sorted
        /// by id), an uncovered pitch last.
        func smallestIDs(isOptimal: (Key) -> Bool) -> [Int?] {
            var fixed: [Int?] = []
            for i in 0..<rows {
                let candidates: [Int?] = (0..<columns).filter { !fixed.contains($0) } + [nil]
                for j in candidates {
                    if let j, !allowed[i * columns + j] { continue }
                    if isOptimal(solve(fixed: fixed + [j]).key) {
                        fixed.append(j)
                        break
                    }
                }
            }
            return fixed
        }
    }
}

/// The linear assignment problem: a minimum-cost matching of every row to its own column.
enum Assignment {
    /// The column for each row of a row-major `rows` × `columns` cost matrix (`rows <= columns`),
    /// minimising the total. `.infinity` marks a forbidden cell; every row needs a finite one.
    /// Shortest augmenting paths with potentials (Kuhn–Munkres), O(rows² × columns).
    static func minimumCost(_ a: [Double], rows n: Int, columns m: Int) -> [Int] {
        precondition(n <= m)
        // 1-based: row 0 and column 0 are the virtual root of each search.
        var u = [Double](repeating: 0, count: n + 1)
        var v = [Double](repeating: 0, count: m + 1)
        var rowOf = [Int](repeating: 0, count: m + 1)
        var way = [Int](repeating: 0, count: m + 1)
        var minv = [Double](repeating: 0, count: m + 1)
        var used = [Bool](repeating: false, count: m + 1)
        for i in 1...n {
            rowOf[0] = i
            var j0 = 0
            for j in 0...m {
                minv[j] = .infinity
                used[j] = false
            }
            repeat {
                used[j0] = true
                let i0 = rowOf[j0]
                var delta = Double.infinity
                var j1 = 0
                for j in 1...m where !used[j] {
                    let c = a[(i0 - 1) * m + (j - 1)]
                    if c < .infinity {
                        let reduced = c - u[i0] - v[j]
                        if reduced < minv[j] {
                            minv[j] = reduced
                            way[j] = j0
                        }
                    }
                    if minv[j] < delta {
                        delta = minv[j]
                        j1 = j
                    }
                }
                precondition(j1 != 0, "a row has no allowed column")
                for j in 0...m {
                    if used[j] {
                        u[rowOf[j]] += delta
                        v[j] -= delta
                    } else {
                        minv[j] -= delta
                    }
                }
                j0 = j1
            } while rowOf[j0] != 0
            repeat {
                let j1 = way[j0]
                rowOf[j0] = rowOf[j1]
                j0 = j1
            } while j0 != 0
        }
        var columnOf = [Int](repeating: 0, count: n)
        for j in 1...m where rowOf[j] != 0 {
            columnOf[rowOf[j] - 1] = j - 1
        }
        return columnOf
    }
}
