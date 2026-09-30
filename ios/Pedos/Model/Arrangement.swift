/// An Arrangement: which Recording plays each note of a melody (see `CONTEXT.md`).
///
/// Auto-map gives each of a Song's distinct pitches its own Melodic Recording. Until the Swift
/// engine ports the reference planner from `tools/melody-lab/` (#17), the sample model uses the
/// Recording that Pitch Coverage matched to each pitch, so a Song plays with exactly the
/// Recordings that unlocked it.
struct Arrangement: Hashable, Sendable {
    /// The Recording that plays each of the Song's distinct pitches (MIDI, in the score's key).
    let recordingForPitch: [Int: Recording.ID]

    /// The Recordings used, in the order of the pitches they play, lowest first.
    var recordings: [Recording.ID] {
        recordingForPitch.keys.sorted().compactMap { recordingForPitch[$0] }
    }

    /// The Recording that plays `note`.
    func recording(playing note: Song.Note) -> Recording.ID? {
        recordingForPitch[note.pitch]
    }
}
