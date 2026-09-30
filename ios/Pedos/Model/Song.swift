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
}
