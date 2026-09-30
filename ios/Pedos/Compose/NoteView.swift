import SwiftUI

/// A read-only view of a Song's notes over time, each colored by the Recording that plays it,
/// with a playhead while it plays. Tapping picks the nearest note; each note is also its own
/// VoiceOver element.
struct NoteView: View {
    let song: Song
    let arrangement: Arrangement
    /// The name of the Recording that plays a note, for VoiceOver: "Recording 3".
    let recordingName: (Song.Note) -> String
    /// When full playback started; nil when it isn't playing.
    var startedAt: Date?
    /// Notes of this pitch (one Recording's) stand out; the others dim.
    var highlightedPitch: Int?
    var selectedNote: Int?
    var playingNote: Int?
    var onTapNote: (Int) -> Void = { _ in }

    /// System colors for the Song's pitches, lowest first. Red is kept for recording.
    private static let colors: [Color] = [.blue, .green, .orange, .purple, .teal, .pink, .indigo, .brown, .mint, .cyan, .yellow]

    /// The color of the Song's `index`th pitch, lowest first, and of the Recording that plays it.
    static func color(forPitchAt index: Int) -> Color {
        colors[index % colors.count]
    }

    var body: some View {
        GeometryReader { geometry in
            let layout = Layout(song: song, size: geometry.size)
            ZStack(alignment: .topLeading) {
                TimelineView(.animation(paused: startedAt == nil)) { timeline in
                    Canvas { context, _ in
                        draw(in: &context, layout: layout, beat: playheadBeat(at: timeline.date))
                    }
                }
                .accessibilityHidden(true)
                ForEach(song.notes.indices, id: \.self) { index in
                    let rect = layout.rect(of: song.notes[index])
                    Color.clear
                        .frame(width: rect.width, height: rect.height)
                        .accessibilityElement()
                        .accessibilityLabel(label(of: index))
                        .accessibilityValue(value(of: index))
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("note \(index + 1)")
                        .accessibilityAction { onTapNote(index) }
                        .position(x: rect.midX, y: rect.midY)
                }
            }
            // The whole view is the hit target: a tap picks the nearest note.
            .contentShape(Rectangle())
            .onTapGesture(coordinateSpace: .local) { location in
                if let index = layout.nearestNote(to: location, in: song.notes) { onTapNote(index) }
            }
        }
        .padding(12)
        .background(.fill.quaternary, in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Notes")
        .accessibilityIdentifier("note-view")
    }

    private func playheadBeat(at date: Date) -> Double? {
        startedAt.map { date.timeIntervalSince($0) * Double(song.bpm) / 60 }
    }

    private func colorIndex(of note: Song.Note) -> Int {
        song.pitches.firstIndex(of: note.pitch) ?? 0
    }

    private func draw(in context: inout GraphicsContext, layout: Layout, beat: Double?) {
        // A faint line every bar of 4 beats.
        for bar in stride(from: 4.0, to: layout.beats, by: 4) {
            context.fill(Path(CGRect(x: layout.x(bar), y: 0, width: 1, height: layout.size.height)), with: .style(.separator))
        }

        for (index, note) in song.notes.enumerated() {
            let rect = layout.rect(of: note)
            let isSounding = beat.map { note.start <= $0 && $0 < note.start + note.length } ?? false
            context.opacity = if let highlightedPitch {
                note.pitch == highlightedPitch ? 1 : 0.2
            } else if beat != nil {
                isSounding ? 1 : 0.45
            } else {
                1
            }
            let shape = Path(roundedRect: rect, cornerRadius: rect.height / 2)
            context.fill(shape, with: .color(Self.color(forPitchAt: colorIndex(of: note))))
            if index == selectedNote {
                context.opacity = 1
                let ring = Path(roundedRect: rect.insetBy(dx: -3, dy: -3), cornerRadius: rect.height / 2 + 3)
                context.stroke(ring, with: .style(.primary), lineWidth: 2)
            }
        }

        if let beat, beat <= layout.beats {
            context.opacity = 1
            context.fill(Path(CGRect(x: layout.x(beat) - 1, y: 0, width: 2, height: layout.size.height)), with: .style(.primary))
        }
    }

    private func label(of index: Int) -> String {
        let note = song.notes[index]
        let start = song.seconds(of: note).start.formatted(.number.precision(.fractionLength(1)))
        return "\(Pitch.name(Double(arrangement.soundingPitch(note.pitch)))) at \(start) s, \(recordingName(note))"
    }

    private func value(of index: Int) -> String {
        [
            index == selectedNote ? "selected" : nil,
            highlightedPitch == song.notes[index].pitch ? "highlighted" : nil,
            index == playingNote ? "playing" : nil,
        ].compactMap { $0 }.joined(separator: ", ")
    }

    /// Where notes sit in the view: time across, pitch up.
    private struct Layout {
        let size: CGSize
        let beats: Double
        let low: Double
        let high: Double
        let noteHeight: CGFloat

        init(song: Song, size: CGSize) {
            self.size = size
            beats = max(song.beats, 1)
            low = Double((song.pitches.first ?? 60) - 1)
            high = Double((song.pitches.last ?? 60) + 1)
            noteHeight = min(10, size.height / max(high - low, 1))
        }

        func x(_ beat: Double) -> CGFloat { size.width * beat / beats }

        func rect(of note: Song.Note) -> CGRect {
            CGRect(
                x: x(note.start),
                y: (size.height - noteHeight) * (high - Double(note.pitch)) / (high - low),
                width: max(4, x(note.start + note.length) - x(note.start) - 2),
                height: noteHeight
            )
        }

        /// The note closest to `point`: zero distance inside it.
        func nearestNote(to point: CGPoint, in notes: [Song.Note]) -> Int? {
            notes.indices.min { a, b in distance(from: point, to: rect(of: notes[a])) < distance(from: point, to: rect(of: notes[b])) }
        }

        private func distance(from point: CGPoint, to rect: CGRect) -> CGFloat {
            let dx = max(rect.minX - point.x, 0, point.x - rect.maxX)
            let dy = max(rect.minY - point.y, 0, point.y - rect.maxY)
            return (dx * dx + dy * dy).squareRoot()
        }
    }
}

#if DEBUG
#Preview {
    let model = SampleAppModel.preview(start: .all)
    let song = model.song("twinkle")!
    let arrangement = model.coverage(of: song).matchedArrangement!
    VStack(spacing: 24) {
        NoteView(song: song, arrangement: arrangement, recordingName: { _ in "Recording" })
        NoteView(song: song, arrangement: arrangement, recordingName: { _ in "Recording" }, highlightedPitch: song.pitches[2], selectedNote: 4)
    }
    .frame(height: 400)
    .padding()
}
#endif
