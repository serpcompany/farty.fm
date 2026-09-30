import SwiftUI

/// The Capture Dock (ADR 0005): a stable tab bar that opens on Record, so capture is
/// always one tap away, followed by the Recording shelf, composing and Created Melodies.
///
/// Every area is a placeholder until its slice lands.
struct CaptureDock: View {
    var body: some View {
        TabView {
            Tab("Record", systemImage: "record.circle") {
                RecordArea()
            }

            Tab("Recordings", systemImage: "waveform") {
                DockArea(title: "Recordings") {
                    ContentUnavailableView(
                        "No Recordings yet",
                        systemImage: "waveform",
                        description: Text("Tap Record to capture one fart per Recording.")
                    )
                }
            }

            Tab("Compose", systemImage: "music.note") {
                DockArea(title: "Compose") {
                    ContentUnavailableView(
                        "Nothing to compose with yet",
                        systemImage: "music.note",
                        description: Text("Song Creator and AI Song Creator play melodies using only your Recordings.")
                    )
                }
            }

            Tab("Melodies", systemImage: "music.note.list") {
                DockArea(title: "Created Melodies") {
                    ContentUnavailableView(
                        "No Created Melodies yet",
                        systemImage: "music.note.list",
                        description: Text("Compose one from your Recordings.")
                    )
                }
            }
        }
    }
}

/// The Record area: one big record button and nothing else.
private struct RecordArea: View {
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

/// A dock area with a large navigation title.
private struct DockArea<Content: View>: View {
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
    CaptureDock()
}
