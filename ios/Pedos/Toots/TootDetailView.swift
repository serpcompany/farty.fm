import SwiftUI

/// A Toot's screen, opened from the Toots tab: Song Creator's layout without Save, showing which
/// Recording played which notes. Rename and Delete are in the toolbar menu.
struct TootDetailView: View {
    let model: any AppModel
    /// The Toot when it was opened; the screen follows the model's copy while it exists, and keeps
    /// this one on screen while it closes after Delete.
    let opened: Toot

    @Environment(\.dismiss) private var dismiss
    @State private var isRenaming = false
    @State private var newTitle = ""
    @State private var isConfirmingDelete = false

    private var toot: Toot { model.toot(opened.id) ?? opened }

    var body: some View {
        if let song = model.song(toot.songID) {
            TootLayout(model: model, song: song, arrangement: toot.arrangement, tootID: toot.id, item: .toot(toot.id)) {
                Text(song.source)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if toot.isAudioMissing {
                    Label("This Toot's audio is missing", systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle(toot.title)
            .navigationSubtitle(song.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            newTitle = toot.title
                            isRenaming = true
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            isConfirmingDelete = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    } label: {
                        Label("More", systemImage: "ellipsis")
                    }
                    .accessibilityIdentifier("toot-menu")
                }
            }
            .alert("Rename", isPresented: $isRenaming) {
                TextField("Name", text: $newTitle)
                Button("Cancel", role: .cancel) {}
                Button("Save") { model.renameToot(toot.id, to: newTitle) }
            }
            .confirmationDialog("Delete \(toot.title)?", isPresented: $isConfirmingDelete, titleVisibility: .visible) {
                Button("Delete Toot", role: .destructive) {
                    model.deleteToot(toot.id)
                    dismiss()
                }
            } message: {
                Text("This can't be undone.")
            }
            .onDisappear { model.stopPlayback() }
        }
    }
}

#if DEBUG
#Preview {
    let model = SampleAppModel.preview(start: .all, toots: ["mary"])
    NavigationStack {
        TootDetailView(model: model, opened: model.toots[0])
    }
}
#endif
