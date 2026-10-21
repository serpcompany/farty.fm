import Foundation
import Testing
@testable import RecordingAnalysisKit

/// #40 and #43: Auto-map and Pitch Coverage match the reference's `melody_fit()` for every Song
/// on both golden libraries and all 50 `coverage.json` subsets, under the tie-aware rule in
/// `fixtures/golden/README.md` ("When an Arrangement matches").
@Suite struct AutoMapTests {
    @Test func everySongOnEveryGoldenLibraryMatches() {
        var cases = 0, matches = 0
        var mismatches: [String] = []
        var worstCostError = 0.0

        func check(_ name: String, song: String, library: [String], golden: AutoMapGolden.Fit) {
            cases += 1
            let result = AutoMap.arrange(AutoMapGolden.song(song), recordings: AutoMapGolden.recordings(library))
            let problems = AutoMapGolden.problems(result, golden: golden, song: song, worstCostError: &worstCostError)
            if problems.isEmpty {
                matches += 1
            } else {
                mismatches.append("\(name) \(song): " + problems.joined(separator: "; "))
            }
        }

        for (library, ids) in AutoMapGolden.index.libraries.sorted(by: { $0.key < $1.key }) {
            for song in AutoMapGolden.index.songs.map(\.id) {
                check(library, song: song, library: ids, golden: AutoMapGolden.arrangement(library, song))
            }
        }
        for (n, subset) in AutoMapGolden.coverage.subsets.enumerated() {
            for fit in subset.songs {
                check("subset \(n) [\(subset.recordings.joined(separator: " "))]", song: fit.song,
                      library: subset.recordings, golden: AutoMapGolden.Fit(fit))
            }
        }

        print("Auto-map golden: \(matches) of \(cases) Song × library cases match; recomputed cost within \(String(format: "%.1e", worstCostError)) of plan_cost")
        for line in mismatches { print("  MISMATCH \(line)") }
        #expect(cases == 13 * (2 + 50))
        #expect(mismatches.isEmpty, "\(mismatches.joined(separator: "\n"))")
    }

    /// The reference gives the identical Arrangement for any library order; so must the port.
    @Test func libraryOrderDoesNotMatter() {
        var generator = SplitMix64(seed: 40)
        let full = AutoMapGolden.recordings(AutoMapGolden.index.libraries["full"]!)
        for song in AutoMapGolden.index.songs.map(\.id) {
            let expected = AutoMap.arrange(AutoMapGolden.song(song), recordings: full)
            for _ in 0..<10 {
                let shuffled = AutoMap.arrange(AutoMapGolden.song(song), recordings: full.shuffled(using: &generator))
                #expect(shuffled == expected, "\(song)")
            }
        }
    }

    /// The app builds Auto-map's input from stored analyses; the gesture length must come out in
    /// whole samples, as the reference measures it.
    @Test func recordingFromAnalysisKeepsTheGestureLengthInSamples() {
        for golden in Golden.recordings {
            let analysis = RecordingAnalysis(
                version: RecordingAnalysis.currentVersion,
                gestureStartSeconds: Double(golden.gesture.startSample) / 44100,
                gestureEndSeconds: Double(golden.gesture.endSample) / 44100,
                cutAtReattack: golden.gesture.cutAtReattack, pitchEstimateMIDI: golden.pitchEstimateMidi,
                pitchConfidence: golden.pitchConfidence, recordingPitchMIDI: golden.recordingPitchMidi,
                shortestNoteSeconds: golden.shortestNoteS)
            let recording = AutoMap.Recording(id: golden.id, analysis: analysis)
            #expect(recording == AutoMapGolden.recording(golden))
        }
    }

    @Test func noMelodicRecordingsCoverNothing() {
        let result = AutoMap.arrange(AutoMapGolden.song("mary"), recordings: AutoMapGolden.recordings(["002", "009", "016"]))
        #expect(result.covered == 0 && result.total == 4 && !result.isUnlocked)
        #expect(result.transposition == -36)  // every transposition ties; the lowest wins, as in the reference
        #expect(result.missingNotes == [72, 74, 76, 79].map { $0 - 36 })
    }

    @Test func assignmentSolverFindsTheMinimum() {
        // Brute force on small random matrices, some cells forbidden.
        var generator = SplitMix64(seed: 7)
        for _ in 0..<300 {
            let n = Int.random(in: 1...4, using: &generator)
            let m = n + Int.random(in: 0...3, using: &generator)
            var a = (0..<(n * m)).map { _ in Double.random(in: 0...10, using: &generator) }
            for r in 0..<n {
                for c in 0..<m where c != r && Double.random(in: 0...1, using: &generator) < 0.3 { a[r * m + c] = .infinity }
            }
            let columns = Assignment.minimumCost(a, rows: n, columns: m)
            #expect(Set(columns).count == n)
            let total = (0..<n).reduce(0.0) { $0 + a[$1 * m + columns[$1]] }
            #expect(abs(total - bruteForce(a, n, m)) < 1e-9)
        }
    }

    private func bruteForce(_ a: [Double], _ n: Int, _ m: Int, row: Int = 0, used: Set<Int> = []) -> Double {
        if row == n { return 0 }
        var best = Double.infinity
        for c in 0..<m where !used.contains(c) && a[row * m + c] < .infinity {
            best = min(best, a[row * m + c] + bruteForce(a, n, m, row: row + 1, used: used.union([c])))
        }
        return best
    }
}

/// Auto-map has to run for every Song each time a Recording is added. Timings only mean
/// something in optimized builds, so this suite runs with `swift test -c release`.
@Suite(.serialized, .enabled(if: autoMapOptimizedBuild, "timings need an optimized build: swift test -c release"))
struct AutoMapTimingTests {
    @Test func everySongOnTheFullLibrary() {
        let library = AutoMapGolden.recordings(AutoMapGolden.index.libraries["full"]!)
        let songs = AutoMapGolden.index.songs.map { AutoMapGolden.song($0.id) }
        let best = bestOf(10) { for song in songs { _ = AutoMap.arrange(song, recordings: library) } }
        print("Timing (release), Auto-map of all \(songs.count) Songs on the full Fixture Library (23 Recordings, 9 Melodic): \(autoMapMS(best)) (best of 10)")
        #expect(best < .milliseconds(250))
    }

    /// A bigger library than the Fixture Library: the 9 Melodic fixtures copied 5 times, each copy
    /// moved by a different whole number of semitones (45 Melodic Recordings). Copies keep the
    /// fixture's other values, so many Arrangements tie and the tie-break does the most work.
    @Test func everySongOnFortyFiveMelodicRecordings() {
        let melodic = AutoMapGolden.recordings(AutoMapGolden.index.melodicRecordings)
        let library = [-7, -3, 0, 4, 9].flatMap { offset in
            melodic.map { r in
                AutoMap.Recording(id: "\(r.id)\(offset)", recordingPitchMIDI: r.recordingPitchMIDI! + Double(offset),
                                  shortestNoteSeconds: r.shortestNoteSeconds, gestureSeconds: r.gestureSeconds)
            }
        }
        let songs = AutoMapGolden.index.songs.map { AutoMapGolden.song($0.id) }
        let best = bestOf(3) { for song in songs { _ = AutoMap.arrange(song, recordings: library) } }
        print("Timing (release), Auto-map of all \(songs.count) Songs on 45 Melodic Recordings: \(autoMapMS(best)) (best of 3)")
    }

    private func bestOf(_ n: Int, _ body: () -> Void) -> Duration {
        let clock = ContinuousClock()
        return (0..<n).map { _ in clock.measure(body) }.min()!
    }
}

#if DEBUG
    private let autoMapOptimizedBuild = false
#else
    private let autoMapOptimizedBuild = true
#endif

private func autoMapMS(_ d: Duration) -> String {
    let c = d.components
    return String(format: "%.1f ms", Double(c.seconds) * 1000 + Double(c.attoseconds) / 1e15)
}

/// A small deterministic generator, so the shuffles and random matrices are the same every run.
struct SplitMix64: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// The golden planner answers (format version 2): `index.json`, `arrangements/` and
/// `coverage.json` from the frozen copy in `Tests/GoldenFormat2/` (#116), and `songs/` from
/// `fixtures/golden/`, which format 3 didn't change.
enum AutoMapGolden {
    struct Index: Decodable {
        struct SongEntry: Decodable { let id: String }
        let formatVersion: Int
        let libraries: [String: [String]]
        let melodicRecordings: [String]
        let songs: [SongEntry]
    }

    struct Song: Decodable {
        struct Note: Decodable {
            let start: Double
            let dur: Double
            let pitch: Int
        }
        let bpm: Double
        let notes: [Note]
    }

    struct Coverage: Decodable {
        let covered: Int
        let total: Int
    }

    struct Arrangement: Decodable {
        struct PerPitch: Decodable {
            let songPitch: Int
            let targetMidi: Int
            let recording: String?
            let shiftSemitones: Double?
            let octaveMove: Bool?
        }
        struct Note: Decodable {
            let index: Int
            let songPitch: Int
            let targetMidi: Int
            let recording: String
        }
        let unlocked: Bool
        let pitchCoverage: Coverage
        let transpose: Int
        let octaveMoves: Int
        let planCost: Double
        let perPitch: [PerPitch]
        let notes: [Note]?
    }

    struct CoverageFile: Decodable {
        struct Subset: Decodable {
            struct Entry: Decodable {
                let song: String
                let unlocked: Bool
                let pitchCoverage: Coverage
                let transpose: Int
                let octaveMoves: Int
                let planCost: Double
                let recordingForPitch: [String: String?]
            }
            let recordings: [String]
            let songs: [Entry]
        }
        let subsets: [Subset]
    }

    /// One golden fit, from an arrangement file or a `coverage.json` entry.
    struct Fit {
        let unlocked: Bool
        let pitchCoverage: Coverage
        let transpose: Int
        let octaveMoves: Int
        let planCost: Double
        let recordingForPitch: [Int: String?]
        /// Arrangement files only.
        let perPitch: [Arrangement.PerPitch]?
        let notes: [Arrangement.Note]?

        init(_ a: Arrangement) {
            unlocked = a.unlocked
            pitchCoverage = a.pitchCoverage
            transpose = a.transpose
            octaveMoves = a.octaveMoves
            planCost = a.planCost
            recordingForPitch = Dictionary(uniqueKeysWithValues: a.perPitch.map { ($0.songPitch, $0.recording) })
            perPitch = a.perPitch
            notes = a.notes
        }

        init(_ e: CoverageFile.Subset.Entry) {
            unlocked = e.unlocked
            pitchCoverage = e.pitchCoverage
            transpose = e.transpose
            octaveMoves = e.octaveMoves
            planCost = e.planCost
            recordingForPitch = Dictionary(uniqueKeysWithValues: e.recordingForPitch.map { (Int($0.key)!, $0.value) })
            perPitch = nil
            notes = nil
        }
    }

    private static func load<T: Decodable>(_ type: T.Type, _ path: String, from dir: URL = Golden.goldenFormat2Dir) -> T {
        let data = try! Data(contentsOf: dir.appending(path: path))
        return try! Golden.decoder().decode(type, from: data)
    }

    static let index: Index = {
        let index = load(Index.self, "index.json")
        precondition(index.formatVersion == 2, "the Auto-map tests read golden format version 2")
        return index
    }()

    static let coverage = load(CoverageFile.self, "coverage.json")

    static let goldenSongs: [String: Song] = Dictionary(uniqueKeysWithValues: index.songs.map {
        ($0.id, load(Song.self, "songs/\($0.id).json", from: Golden.goldenDir))
    })

    static func arrangement(_ library: String, _ song: String) -> Fit {
        Fit(load(Arrangement.self, "arrangements/\(library)/\(song).json"))
    }

    static func song(_ id: String) -> AutoMap.Song {
        let song = goldenSongs[id]!
        return AutoMap.Song(bpm: song.bpm, notes: song.notes.map { AutoMap.Song.Note(pitch: $0.pitch, lengthBeats: $0.dur) })
    }

    static func recording(_ r: Golden.Recording) -> AutoMap.Recording {
        AutoMap.Recording(id: r.id, recordingPitchMIDI: r.recordingPitchMidi, shortestNoteSeconds: r.shortestNoteS,
                          gestureSeconds: Double(r.gesture.endSample - r.gesture.startSample) / 44100)
    }

    static func recordings(_ ids: [String]) -> [AutoMap.Recording] {
        ids.map { id in recording(Golden.recordings.first { $0.id == id }!) }
    }

    /// Every way `result` differs from the golden fit, per the README's matching rule. Empty
    /// when it matches.
    static func problems(_ result: AutoMap.Result, golden: Fit, song songID: String, worstCostError: inout Double) -> [String] {
        var problems: [String] = []
        func expect(_ ok: Bool, _ message: @autoclosure () -> String) { if !ok { problems.append(message()) } }

        expect(result.isUnlocked == golden.unlocked, "unlocked \(result.isUnlocked), golden \(golden.unlocked)")
        expect(result.covered == golden.pitchCoverage.covered && result.total == golden.pitchCoverage.total,
               "coverage \(result.covered) of \(result.total), golden \(golden.pitchCoverage.covered) of \(golden.pitchCoverage.total)")
        expect(result.transposition == golden.transpose, "transpose \(result.transposition), golden \(golden.transpose)")
        expect(result.octaveMoves == golden.octaveMoves, "Octave Moves \(result.octaveMoves), golden \(golden.octaveMoves)")
        let ids = Dictionary(uniqueKeysWithValues: result.pitches.map { ($0.songPitch, $0.recordingID) })
        expect(ids.keys.sorted() == golden.recordingForPitch.keys.sorted(), "pitches \(ids.keys.sorted())")
        for (pitch, id) in golden.recordingForPitch.sorted(by: { $0.key < $1.key }) {
            expect(ids[pitch] == id, "pitch \(pitch): \(String(describing: ids[pitch] ?? nil)), golden \(String(describing: id))")
        }
        let goldenMissing = golden.recordingForPitch.filter { $0.value == nil }.keys.sorted().map { $0 + golden.transpose }
        expect(result.missingNotes == goldenMissing, "missing notes \(result.missingNotes), golden \(goldenMissing)")

        if let perPitch = golden.perPitch {
            for g in perPitch {
                guard let choice = result.choice(forSongPitch: g.songPitch) else { continue }
                expect(choice.targetMIDI == g.targetMidi, "pitch \(g.songPitch): target \(choice.targetMIDI), golden \(g.targetMidi)")
                if let goldenShift = g.shiftSemitones, let shift = choice.shiftSemitones {
                    expect(abs(shift - goldenShift) <= 1e-9, "pitch \(g.songPitch): shift \(shift), golden \(goldenShift)")
                } else {
                    expect(choice.shiftSemitones == nil && g.shiftSemitones == nil, "pitch \(g.songPitch): shift")
                }
                expect(choice.isOctaveMove == (g.octaveMove ?? false), "pitch \(g.songPitch): Octave Move \(choice.isOctaveMove)")
            }
        }
        if golden.unlocked, let notes = golden.notes {
            let songNotes = goldenSongs[songID]!.notes
            expect(notes.count == songNotes.count, "note count")
            for note in notes {
                let pitch = songNotes[note.index].pitch
                let choice = result.choice(forSongPitch: pitch)
                expect(pitch + result.transposition == note.targetMidi && choice?.recordingID == note.recording,
                       "note \(note.index): \(pitch + result.transposition) on \(String(describing: choice?.recordingID)), golden \(note.targetMidi) on \(note.recording)")
            }
        }

        // The cost recomputed from the Arrangement under test, never the planner's own total.
        do {
            let recomputed = try GoldenCost.arrangementCost(song: goldenSongs[songID]!, transpose: result.transposition, recordingForPitch: ids)
            expect(recomputed.uncovered == golden.pitchCoverage.total - golden.pitchCoverage.covered, "recomputed uncovered \(recomputed.uncovered)")
            expect(recomputed.octaves == golden.octaveMoves, "recomputed Octave Moves \(recomputed.octaves)")
            let error = abs(recomputed.cost - golden.planCost)
            worstCostError = max(worstCostError, error)
            expect(error <= 1e-9, "recomputed cost \(recomputed.cost), golden \(golden.planCost)")
        } catch {
            problems.append("arrangement rejected: \(error)")
        }
        // The planner's own total, which the app may show, agrees too.
        expect(abs(result.cost - golden.planCost) <= 1e-9, "Auto-map's own cost \(result.cost), golden \(golden.planCost)")
        return problems
    }
}

/// A port of `tools/melody-lab/golden_cost.py`'s `arrangement_cost()`, written apart from
/// `AutoMap` so it checks the planner rather than repeating it.
enum GoldenCost {
    struct Rejected: Error, CustomStringConvertible {
        let description: String
    }

    /// (uncovered pitches, Octave Moves, cost) of an Arrangement, from the golden inputs alone.
    static func arrangementCost(song: AutoMapGolden.Song, transpose: Int, recordingForPitch: [Int: String?]) throws -> (uncovered: Int, octaves: Int, cost: Double) {
        let pitches = Set(song.notes.map(\.pitch)).sorted()
        guard recordingForPitch.keys.sorted() == pitches else { throw Rejected(description: "one entry per distinct Song pitch") }
        let used = recordingForPitch.values.compactMap { $0 }
        guard used.count == Set(used).count else { throw Rejected(description: "a Recording plays at most one pitch") }
        let spb = 60 / song.bpm
        var uncovered = 0, octaves = 0
        var cost = 0.0
        for p in pitches {
            guard let id = recordingForPitch[p]! else {
                uncovered += 1
                continue
            }
            guard let rec = Golden.recordings.first(where: { $0.id == id }) else { throw Rejected(description: "no Recording \(id)") }
            guard rec.melodic, let pitch = rec.recordingPitchMidi, let shortest = rec.shortestNoteS else {
                throw Rejected(description: "\(id) is Noise-like")
            }
            let shift = Double(p + transpose) - pitch
            // engine.move_cost()
            let a = abs(shift)
            let move: (Double, Bool)
            if a <= 3 {
                move = (pow(a, 1.5), false)
            } else if abs(a - 12) <= 3 {
                move = (6 + pow(abs(a - 12), 1.5), true)
            } else {
                throw Rejected(description: "\(id) can't play \(p + transpose) (shift \(shift))")
            }
            let notes = song.notes.filter { $0.pitch == p }
            let weight = notes.reduce(0.0) { $0 + $1.dur }
            let seconds = Double(rec.gesture.endSample - rec.gesture.startSample) / 44100
            // engine.too_short_cost()
            let played = seconds * pow(2, -shift / 12)
            var tooShort = 0.0
            for note in notes {
                let sounds = min(note.dur * spb - 0.025, played)
                if sounds < shortest { tooShort += 8 + 400 * (shortest - sounds) }
            }
            if move.1 { octaves += 1 }
            cost += weight * move.0 + tooShort
        }
        return (uncovered, octaves, cost)
    }
}
