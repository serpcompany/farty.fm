import SwiftUI

/// The four tabs from `docs/design/app-map.md`: Record opens first, followed by
/// Recordings, Compose and Melodies.
///
/// Each tab is a placeholder until its slice lands.
struct AppTabs: View {
    var body: some View {
        TabView {
            Tab("Record", systemImage: "record.circle") {
                RecordTab()
            }

            Tab("Recordings", systemImage: "waveform") {
                TitledTab(title: "Recordings") {
                    ContentUnavailableView(
                        "No Recordings yet",
                        systemImage: "waveform",
                        description: Text("Go to the Record tab and tap the red button.")
                    )
                }
            }

            Tab("Compose", systemImage: "music.note") {
                TitledTab(title: "Compose") {
                    ContentUnavailableView(
                        "No Melodic Recordings yet",
                        systemImage: "music.note",
                        description: Text("Record a few farts with a clear note to start unlocking Songs.")
                    )
                }
            }

            Tab("Melodies", systemImage: "music.note.list") {
                TitledTab(title: "Melodies") {
                    ContentUnavailableView(
                        "Nothing yet",
                        systemImage: "music.note.list",
                        description: Text("Make one in Compose.")
                    )
                }
            }
        }
    }
}

/// The Record tab: one big red record button and nothing else.
private struct RecordTab: View {
    var body: some View {
        Button {
            // The record slice starts capturing a Recording here.
        } label: {
            Circle()
                .fill(.red)
                .frame(width: 180, height: 180)
        }
        .accessibilityLabel("Record")
        .accessibilityIdentifier("record-button")
    }
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

#Preview {
    AppTabs()
}
