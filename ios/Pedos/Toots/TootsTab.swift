import SwiftUI

/// Every Toot, newest first. Tap a row's play button to play it, or the row to open it; long-press
/// to rename or delete it.
struct TootsTab: View {
    let model: any AppModel

    @State private var renaming: Toot?
    @State private var newTitle = ""
    @State private var pendingDelete: Toot?
    @State private var missingAudio: Toot?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Group {
                if model.toots.isEmpty {
                    ContentUnavailableView(
                        "Nothing yet",
                        systemImage: "music.note.list",
                        description: Text("Make one in Compose.")
                    )
                } else {
                    list
                }
            }
            .navigationTitle("Toots")
            .navigationBarTitleDisplayMode(.large)
            .navigationDestination(for: Toot.ID.self) { id in
                if let toot = model.toot(id) {
                    TootDetailView(model: model, opened: toot)
                }
            }
            // Each alert sits on its own view: two on one view get in each other's way.
            .alert("This Toot's audio is missing", isPresented: isPresented($missingAudio), presenting: missingAudio) { toot in
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    withAnimation { model.deleteToot(toot.id) }
                }
            } message: { _ in
                Text("It can't be played. You can delete it and make it again in Compose.")
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // The app comes back on the Record tab, so nothing is left open here.
            if phase == .background {
                renaming = nil
                pendingDelete = nil
                missingAudio = nil
            }
        }
    }

    private var list: some View {
        List {
            ForEach(model.toots.reversed()) { toot in
                TootRow(toot: toot, songTitle: model.song(toot.songID)?.title ?? "", isPlaying: model.nowPlaying == .toot(toot.id)) {
                    if toot.isAudioMissing {
                        missingAudio = toot
                    } else {
                        model.togglePlayback(of: .toot(toot.id))
                    }
                }
                .swipeActions {
                    Button { pendingDelete = toot } label: { Label("Delete", systemImage: "trash") }
                        .tint(.red)
                }
                .contextMenu {
                    Button {
                        newTitle = toot.title
                        renaming = toot
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }
                    Button(role: .destructive) { pendingDelete = toot } label: { Label("Delete", systemImage: "trash") }
                }
            }
        }
        .alert("Rename", isPresented: isPresented($renaming), presenting: renaming) { toot in
            TextField("Name", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Save") { model.renameToot(toot.id, to: newTitle) }
        }
        .confirmationDialog(
            pendingDelete.map { "Delete \($0.title)?" } ?? "",
            isPresented: isPresented($pendingDelete),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { toot in
            Button("Delete Toot", role: .destructive) {
                withAnimation { model.deleteToot(toot.id) }
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

/// A Toot's row: a play button, then the title and the Song it came from, its date and length,
/// which open the Toot's screen.
private struct TootRow: View {
    let toot: Toot
    let songTitle: String
    let isPlaying: Bool
    let play: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: play) {
                Image(systemName: toot.isAudioMissing ? "exclamationmark.triangle" : isPlaying ? "stop.circle.fill" : "play.circle")
                    .font(.title2)
                    .foregroundStyle(toot.isAudioMissing ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            // Only the icon plays; the rest of the row opens the Toot.
            .buttonStyle(.borderless)
            .accessibilityLabel(toot.isAudioMissing ? "Audio missing" : isPlaying ? "Stop" : "Play")
            .accessibilityIdentifier("play \(toot.title)")
            NavigationLink(value: toot.id) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(toot.title)
                    Text(details)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityLabel(toot.title)
            .accessibilityValue(isPlaying ? "\(details), playing" : details)
            .accessibilityIdentifier(toot.title)
        }
        .listRowBackground(isPlaying ? Color(.systemFill) : nil)
    }

    /// "Mary Had a Little Lamb · Today · 0:12", or "… · Audio missing".
    private var details: String {
        let rest = toot.isAudioMissing
            ? ["Audio missing"]
            : [Self.dateFormatter.string(from: toot.createdAt), formattedTootLength(toot.seconds)]
        return ([songTitle] + rest).joined(separator: " · ")
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
#Preview("Toots") {
    TootsTab(model: SampleAppModel.preview(start: .all, toots: ["twinkle", "mary"]))
}

#Preview("Toots, empty") {
    TootsTab(model: SampleAppModel.preview())
}

#Preview("Toots, audio missing") {
    TootsTab(model: SampleAppModel.preview(start: .all, toots: ["mary", "ode"], failures: .tootAudioMissing))
}
#endif
