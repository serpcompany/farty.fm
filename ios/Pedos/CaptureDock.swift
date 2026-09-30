import SwiftUI

/// The Capture Dock (ADR 0005): a stable tab bar that opens on Record, so capture is
/// always one tap away, followed by the Recording shelf, creation and Created Melodies.
///
/// Every area is a placeholder until its slice lands.
struct CaptureDock: View {
    var body: some View {
        TabView {
            RecordArea()
                .tabItem { Label("Record", systemImage: "record.circle") }

            DockArea(title: "Recordings") {
                ContentUnavailableView(
                    "No Recordings yet",
                    systemImage: "waveform",
                    description: Text("Tap Record to capture one fart per Recording.")
                )
            }
            .tabItem { Label("Recordings", systemImage: "waveform") }

            DockArea(title: "Create") {
                ContentUnavailableView(
                    "Nothing to create with yet",
                    systemImage: "music.note",
                    description: Text("Song Creator and AI Song Creator play melodies using only your Recordings.")
                )
            }
            .tabItem { Label("Create", systemImage: "music.note") }

            DockArea(title: "Created Melodies") {
                ContentUnavailableView(
                    "No Created Melodies yet",
                    systemImage: "music.note.list",
                    description: Text("Create one from your Recordings.")
                )
            }
            .tabItem { Label("Melodies", systemImage: "music.note.list") }
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

/// A titled dock area.
private struct DockArea<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
        }
    }
}

#Preview {
    CaptureDock()
}
