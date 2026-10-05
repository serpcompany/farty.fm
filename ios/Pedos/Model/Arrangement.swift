import Foundation

/// An Arrangement: which Recording plays each of a Song's distinct pitches, and so each of its
/// notes (see `CONTEXT.md`). Auto-map chooses it (`CoverageResult.matchedArrangement`), and
/// Song Creator renders the Toot with it.
struct Arrangement: Hashable, Sendable {
    /// The Recording that plays each of the Song's distinct pitches (MIDI, in the score's key).
    let recordingForPitch: [Int: Recording.ID]
    /// Semitones the Song is moved by to meet the Recordings: a note of pitch `p` sounds at
    /// `p + transposition`.
    let transposition: Int

    /// No Recordings at all.
    static let empty = Arrangement(recordingForPitch: [:], transposition: 0)

    /// The Recordings used, in the order of the pitches they play, lowest first.
    var recordings: [Recording.ID] {
        recordingForPitch.keys.sorted().compactMap { recordingForPitch[$0] }
    }

    /// The Recording that plays `note`.
    func recording(playing note: Song.Note) -> Recording.ID? {
        recordingForPitch[note.pitch]
    }

    /// The note a pitch of the score sounds at, as a MIDI note number.
    func soundingPitch(_ pitch: Int) -> Int {
        pitch + transposition
    }

    /// How far `recording` is moved to sound `note`, in semitones: the note's MIDI minus the
    /// Recording Pitch. Nil when the Recording has no pitch.
    func shift(of note: Song.Note, by recording: Recording) -> Double? {
        recording.pitch.map { Double(soundingPitch(note.pitch)) - $0 }
    }

    /// What a selected note shows: "A3 · Recording 20 (G♯3), shifted +1.2 semitones · 0.4 s",
    /// or "A3 · Recording deleted · 0.4 s" once its Recording is gone.
    func caption(of note: Song.Note, in song: Song, recording: Recording?) -> String {
        let name = Pitch.name(Double(soundingPitch(note.pitch)))
        let length = formattedLength(song.seconds(of: note).length)
        guard let recording else { return "\(name) · Recording deleted · \(length)" }
        guard let pitch = recording.pitch, let shift = shift(of: note, by: recording) else {
            return "\(name) · \(recording.name) · \(length)"
        }
        return "\(name) · \(recording.name) (\(Pitch.name(pitch))), shifted \(Self.semitones(shift)) · \(length)"
    }

    /// "+1.2 semitones", "−2.8 semitones", "0.0 semitones".
    static func semitones(_ shift: Double) -> String {
        let rounded = (shift * 10).rounded() / 10
        let magnitude = abs(rounded).formatted(.number.precision(.fractionLength(1)))
        let sign = rounded > 0 ? "+" : rounded < 0 ? "−" : ""
        return "\(sign)\(magnitude) semitones"
    }
}
