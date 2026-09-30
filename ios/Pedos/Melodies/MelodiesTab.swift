import SwiftUI

/// Every Created Melody, newest first. Tap a row to play it; long-press to rename or delete it.
struct MelodiesTab: View {
    let model: any AppModel

    @State private var renaming: CreatedMelody?
    @State private var newTitle = ""
    @State private var pendingDelete: CreatedMelody?
    @State private var missingAudio: CreatedMelody?

    var body: some View {
        NavigationStack {
            Group {
                if model.melodies.isEmpty {
                    ContentUnavailableView(
                        "Nothing yet",
                        systemImage: "music.note.list",
                        description: Text("Make one in Compose.")
                    )
                } else {
                    list
                }
            }
            .navigationTitle("Melodies")
            .navigationBarTitleDisplayMode(.large)
            // Each alert sits on its own view: two on one view get in each other's way.
            .alert("This melody's audio is missing", isPresented: isPresented($missingAudio), presenting: missingAudio) { melody in
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    withAnimation { model.deleteMelody(melody.id) }
                }
            } message: { _ in
                Text("It can't be played. You can delete it and make it again in Compose.")
            }
        }
    }

    private var list: some View {
        List {
            ForEach(model.melodies.reversed()) { melody in
                MelodyRow(melody: melody, isPlaying: model.nowPlaying == .melody(melody.id)) {
                    if melody.isAudioMissing {
                        missingAudio = melody
                    } else {
                        model.togglePlayback(of: .melody(melody.id))
                    }
                }
                .swipeActions {
                    Button { pendingDelete = melody } label: { Label("Delete", systemImage: "trash") }
                        .tint(.red)
                }
                .contextMenu {
                    Button {
                        newTitle = melody.title
                        renaming = melody
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }
                    Button(role: .destructive) { pendingDelete = melody } label: { Label("Delete", systemImage: "trash") }
                }
            }
        }
        .alert("Rename", isPresented: isPresented($renaming), presenting: renaming) { melody in
            TextField("Name", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Save") { model.renameMelody(melody.id, to: newTitle) }
        }
        .confirmationDialog(
            pendingDelete.map { "Delete \($0.title)?" } ?? "",
            isPresented: isPresented($pendingDelete),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { melody in
            Button("Delete Melody", role: .destructive) {
                withAnimation { model.deleteMelody(melody.id) }
            }
        } message: { _ in
            Text("This can't be undone.")
        }
    }

    /// Shows while `item` is set, and clears it when dismissed.
    private func isPresented<Item>(_ item: Binding<Item?>) -> Binding<Bool> {
        Binding(get: { item.wrappedValue != nil }, set: { if !$0 { item.wrappedValue = nil } })
    }
}

/// A Created Melody's row: play state, title, and its origin, date and length.
private struct MelodyRow: View {
    let melody: CreatedMelody
    let isPlaying: Bool
    let play: () -> Void

    var body: some View {
        Button(action: play) {
            HStack(spacing: 12) {
                Image(systemName: melody.isAudioMissing ? "exclamationmark.triangle" : isPlaying ? "stop.circle.fill" : "play.circle")
                    .font(.title2)
                    .foregroundStyle(melody.isAudioMissing ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
                VStack(alignment: .leading, spacing: 2) {
                    Text(melody.title)
                    Text(details)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(isPlaying ? Color(.systemFill) : nil)
        .accessibilityLabel(melody.title)
        .accessibilityValue(isPlaying ? "\(details), playing" : details)
        .accessibilityHint(melody.isAudioMissing ? "Its audio is missing" : isPlaying ? "Stops playing" : "Plays the melody")
        .accessibilityIdentifier(melody.title)
    }

    /// "Today · 0:12", with the Song's title first once the melody is renamed, or "Audio missing".
    private var details: String {
        let origin = melody.title == melody.origin ? [] : [melody.origin]
        let rest = melody.isAudioMissing
            ? ["Audio missing"]
            : [Self.dateFormatter.string(from: melody.createdAt), formattedMelodyLength(melody.seconds)]
        return (origin + rest).joined(separator: " · ")
    }

    /// "Today", "Yesterday", or a date.
    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        formatter.doesRelativeDateFormatting = true
        return formatter
    }()
}

#if DEBUG
#Preview("Melodies") {
    MelodiesTab(model: SampleAppModel.preview(start: .all, melodies: ["twinkle", "mary"]))
}

#Preview("Melodies, empty") {
    MelodiesTab(model: SampleAppModel.preview())
}

#Preview("Melodies, audio missing") {
    MelodiesTab(model: SampleAppModel.preview(start: .all, melodies: ["mary", "ode"], failures: .melodyAudioMissing))
}
#endif
