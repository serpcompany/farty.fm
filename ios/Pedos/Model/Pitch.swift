/// Note names for MIDI note numbers, the way the app shows a Recording Pitch ("G♯3").
enum Pitch {
    /// The twelve pitch classes from C, as the pitch strip shows them.
    static let pitchClassNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]

    /// Pitch classes that are black keys on a keyboard.
    static let sharpPitchClasses: Set<Int> = [1, 3, 6, 8, 10]

    /// The nearest note's name with its octave, where MIDI 60 is C4: 55.83 → "G♯3".
    static func name(_ midi: Double) -> String {
        let note = nearestNote(midi)
        let octave = Int((Double(note) / 12).rounded(.down)) - 1
        return pitchClassNames[pitchClass(of: note)] + String(octave)
    }

    /// The nearest note's pitch class, 0 (C) to 11 (B).
    static func pitchClass(_ midi: Double) -> Int {
        pitchClass(of: nearestNote(midi))
    }

    /// The nearest note as a MIDI note number, octave included: 55.83 → 56 (G♯3).
    static func note(_ midi: Double) -> Int {
        nearestNote(midi)
    }

    /// Rounds half up, like the prototype's `Math.round`.
    private static func nearestNote(_ midi: Double) -> Int {
        Int((midi + 0.5).rounded(.down))
    }

    private static func pitchClass(of note: Int) -> Int {
        ((note % 12) + 12) % 12
    }
}

