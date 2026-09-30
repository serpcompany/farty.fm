import SwiftUI

/// A read-only view of a Song's notes over time, each colored by the Recording that plays it,
/// with a playhead while it plays.
struct NoteView: View {
    let song: Song
    let arrangement: Arrangement
    /// When playback started; nil when it isn't playing.
    let startedAt: Date?

    /// System colors for the Recordings, in the Arrangement's order. Red is kept for recording.
    private static let colors: [Color] = [.blue, .green, .orange, .purple, .teal, .pink, .indigo, .brown, .mint, .cyan, .yellow]

    static func color(forRecordingAt index: Int) -> Color {
        colors[index % colors.count]
    }

    var body: some View {
        TimelineView(.animation(paused: startedAt == nil)) { timeline in
            Canvas { context, size in
                draw(in: &context, size: size, beat: playheadBeat(at: timeline.date))
            }
        }
        .padding(12)
        .background(.fill.quaternary, in: .rect(cornerRadius: 16))
        .accessibilityElement()
        .accessibilityLabel("Notes")
        .accessibilityValue("\(song.notes.count) notes, played by \(arrangement.recordings.count) Recordings")
        .accessibilityIdentifier("note-view")
    }

    private func playheadBeat(at date: Date) -> Double? {
        startedAt.map { date.timeIntervalSince($0) * Double(song.bpm) / 60 }
    }

    private func draw(in context: inout GraphicsContext, size: CGSize, beat: Double?) {
        let beats = max(song.beats, 1)
        let low = Double((song.pitches.first ?? 60) - 1)
        let high = Double((song.pitches.last ?? 60) + 1)
        let noteHeight = min(10, size.height / max(high - low, 1))
        let x = { (beat: Double) in size.width * beat / beats }
        let y = { (pitch: Double) in (size.height - noteHeight) * (high - pitch) / (high - low) }
        let order = arrangement.recordings

        // A faint line every bar of 4 beats.
        for bar in stride(from: 4.0, to: beats, by: 4) {
            context.fill(Path(CGRect(x: x(bar), y: 0, width: 1, height: size.height)), with: .style(.separator))
        }

        for note in song.notes {
            let index = arrangement.recording(playing: note).flatMap { order.firstIndex(of: $0) } ?? 0
            let rect = CGRect(
                x: x(note.start),
                y: y(Double(note.pitch)),
                width: max(4, x(note.start + note.length) - x(note.start) - 2),
                height: noteHeight
            )
            let isSounding = beat.map { note.start <= $0 && $0 < note.start + note.length } ?? false
            context.opacity = beat == nil || isSounding ? 1 : 0.45
            context.fill(Path(roundedRect: rect, cornerRadius: noteHeight / 2), with: .color(Self.color(forRecordingAt: index)))
        }

        if let beat, beat <= beats {
            context.opacity = 1
            context.fill(Path(CGRect(x: x(beat) - 1, y: 0, width: 2, height: size.height)), with: .style(.primary))
        }
    }
}

#if DEBUG
#Preview {
    let model = SampleAppModel.preview(start: .all)
    let song = model.song("twinkle")!
    VStack(spacing: 24) {
        NoteView(song: song, arrangement: model.coverage(of: song).arrangement!, startedAt: nil)
        NoteView(song: song, arrangement: model.coverage(of: song).arrangement!, startedAt: .now)
    }
    .frame(height: 400)
    .padding()
}
#endif
