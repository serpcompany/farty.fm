import SwiftUI

/// A Toot's screen, opened from the Toots tab: Song Creator's layout without Save, showing which
/// Recording played which notes. Rename and Delete are in the toolbar menu.
struct TootDetailView: View {
    let model: any AppModel
    /// The Toot when it was opened. The screen follows the model's copy while it exists, and keeps
    /// the last one it saw on screen while it closes after Delete.
    let opened: Toot

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var isRenaming = false
    @State private var newTitle = ""
    @State private var isConfirmingDelete = false
    /// The model's copy as last seen, renamed or not.
    @State private var lastSeen: Toot?

    private var toot: Toot { model.toot(opened.id) ?? lastSeen ?? opened }

    var body: some View {
        if let song = model.song(toot.songID) {
            TootLayout(
                model: model,
                song: song,
                arrangement: toot.arrangement,
                tootID: toot.id,
                item: .toot(toot.id),
                isAudioMissing: toot.isAudioMissing
            ) {
                Text(song.source)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if toot.isAudioMissing {
                    Text("This Toot's audio is missing. You can delete it and make it again in Compose.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("toot-audio-missing")
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
            .onChange(of: model.toot(opened.id)) { _, current in
                if let current { lastSeen = current }
            }
            .onChange(of: scenePhase) { _, phase in
                // The app comes back on the Record tab, so nothing is left open here.
                if phase == .background {
                    isRenaming = false
                    isConfirmingDelete = false
                }
            }
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
