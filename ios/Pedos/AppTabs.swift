import SwiftUI

/// The four tabs from `docs/design/app-map.md`: Record opens first, followed by Recordings,
/// Compose and Melodies. While recording, the other tabs are disabled.
struct AppTabs: View {
    let model: any AppModel
    @State private var selection = AppTab.record

    var body: some View {
        TabView(selection: $selection) {
            Tab("Record", systemImage: "record.circle", value: .record) {
                RecordTab(model: model)
            }

            Tab("Recordings", systemImage: "waveform", value: .recordings) {
                RecordingsTab(model: model)
            }
            .disabled(model.isRecording)

            Tab("Compose", systemImage: "music.note", value: .compose) {
                // #52 builds Compose.
                TitledTab(title: "Compose") {
                    ContentUnavailableView(
                        "No Melodic Recordings yet",
                        systemImage: "music.note",
                        description: Text("Record a few farts with a clear note to start unlocking Songs.")
                    )
                }
            }
            .disabled(model.isRecording)

            Tab("Melodies", systemImage: "music.note.list", value: .melodies) {
                // #52 builds Melodies.
                TitledTab(title: "Melodies") {
                    ContentUnavailableView(
                        "Nothing yet",
                        systemImage: "music.note.list",
                        description: Text("Make one in Compose.")
                    )
                }
            }
            .disabled(model.isRecording)
        }
        .onChange(of: selection) {
            model.stopPlayback()
        }
        .sheet(isPresented: Binding(get: { model.isShowingWelcome }, set: { if !$0 { model.skipWelcome() } })) {
            WelcomeSheet(model: model)
        }
        .fullScreenCover(isPresented: Binding(get: { model.flow != nil }, set: { if !$0 { model.finishFlow() } })) {
            RecordFlowView(
                model: model,
                onDone: { selection = .recordings },
                onRecordAnother: { selection = .record },
                // #52 opens the Song in Song Creator.
                onTry: { _ in selection = .compose }
            )
        }
    }
}

enum AppTab: Hashable {
    case record
    case recordings
    case compose
    case melodies
}

/// A tab with a large navigation title.
private struct TitledTab<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.large)
        }
    }
}
