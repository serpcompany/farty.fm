/// A known melody in the Song Catalog, taken from a cited public-domain score (ADR 0003).
struct Song: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    /// The Song's distinct pitches as MIDI note numbers in the score's key, lowest first.
    let pitches: [Int]
    /// The source and license line, for example "Public domain score · PDMX".
    let source: String
    /// Tempo in beats per minute.
    let bpm: Int
    /// The melody's notes in time order, from the score.
    let notes: [Note]

    /// One note of the melody.
    struct Note: Hashable, Sendable {
        /// When the note starts, in beats from the beginning.
        let start: Double
        /// How long it lasts, in beats.
        let length: Double
        /// MIDI note number, in the score's key.
        let pitch: Int
    }

    /// Where the last note ends, in beats.
    var beats: Double { notes.map { $0.start + $0.length }.max() ?? 0 }
}
