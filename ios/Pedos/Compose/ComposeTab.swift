import SwiftUI

/// Compose: the Song Catalog with each Song's Pitch Coverage. Open an Unlocked Song in Song
/// Creator, or a locked Song to see which notes it still needs.
struct ComposeTab: View {
    let model: any AppModel
    /// The Songs pushed on the stack; Try it on the Result screen sets it.
    @Binding var path: [Song.ID]
    /// Record, from a locked Song: switches to the Record tab.
    let onRecord: () -> Void

    @State private var query = ""
    @State private var order = SongOrder.closestToUnlocking
    @State private var lockedSong: Song?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack(path: $path) {
            list
                .navigationTitle("Compose")
                .navigationBarTitleDisplayMode(.large)
                .searchable(text: $query, prompt: "Search Songs")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Picker("Sort", selection: $order) {
                                Text("Closest to unlocking").tag(SongOrder.closestToUnlocking)
                                Text("A–Z").tag(SongOrder.alphabetical)
                            }
                        } label: {
                            Label("Sort", systemImage: "arrow.up.arrow.down")
                        }
                        .accessibilityIdentifier("sort-songs")
                    }
                }
                .navigationDestination(for: Song.ID.self) { id in
                    if let song = model.song(id) {
                        SongCreatorView(model: model, song: song)
                    }
                }
        }
        .sheet(item: $lockedSong) { song in
            LockedSongSheet(model: model, song: song) {
                lockedSong = nil
                onRecord()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // The app comes back on the Record tab, so the sheet doesn't stay open.
            if phase == .background { lockedSong = nil }
        }
    }

    private var list: some View {
        let listing = model.songListing(matching: query, order: order)
        return List {
            if model.melodicRecordings.isEmpty, query.isEmpty {
                Section {
                    ContentUnavailableView(
                        "No Melodic Recordings yet",
                        systemImage: "music.note",
                        description: Text("Record a few farts with a clear note to start unlocking Songs.")
                    )
                }
            }
            if !listing.unlocked.isEmpty {
                Section("Unlocked · \(listing.unlocked.count)") {
                    ForEach(listing.unlocked) { row in
                        NavigationLink(value: row.song.id) {
                            UnlockedSongRow(song: row.song)
                        }
                        .accessibilityIdentifier(row.song.title)
                    }
                }
            }
            if !listing.locked.isEmpty {
                Section("Locked · \(listing.locked.count)") {
                    ForEach(listing.locked) { row in
                        Button { lockedSong = row.song } label: {
                            LockedSongRow(song: row.song, coverage: row.coverage)
                        }
                        .accessibilityIdentifier(row.song.title)
                    }
                }
            }
        }
        .overlay {
            if listing.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
    }
}

/// An Unlocked Song: its title and "Ready".
private struct UnlockedSongRow: View {
    let song: Song

    var body: some View {
        LabeledContent(song.title, value: "Ready")
    }
}

/// A locked Song: its title, a Pitch Coverage bar, a lock and the nearest missing notes.
private struct LockedSongRow: View {
    let song: Song
    let coverage: CoverageResult

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(song.title)
                ProgressView(value: coverage.fraction)
                VStack(alignment: .leading, spacing: 2) {
                    Text(coverage.summary)
                    if let needs {
                        Text(needs)
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            Image(systemName: "lock.fill")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
        }
        // A button's label is tinted; the row's text stays the usual colors.
        .foregroundStyle(Color.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(song.title)
        .accessibilityValue(["Locked", coverage.summary, needs].compactMap { $0 }.joined(separator: ". "))
    }

    /// "Needs D3, F3, A3, and 2 more".
    private var needs: String? {
        coverage.missingNotes(limit: 3).map { "Needs \($0)" }
    }
}

#if DEBUG
#Preview("Compose, all 23 Recordings") {
    @Previewable @State var path: [Song.ID] = []
    ComposeTab(model: SampleAppModel.preview(start: .all), path: $path, onRecord: {})
}

#Preview("Compose, 3 Recordings") {
    @Previewable @State var path: [Song.ID] = []
    ComposeTab(model: SampleAppModel.preview(start: .takes(3)), path: $path, onRecord: {})
}

#Preview("Compose, no Melodic Recordings") {
    @Previewable @State var path: [Song.ID] = []
    ComposeTab(model: SampleAppModel.preview(), path: $path, onRecord: {})
}
#endif
