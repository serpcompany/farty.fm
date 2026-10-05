import SwiftUI

/// Profile: what you've collected and made, where the Songs come from, and the app version.
/// Everything is counted from what's on the phone; there's no account or sign-in (ADR 0001).
struct ProfileTab: View {
    let model: any AppModel

    var body: some View {
        NavigationStack {
            List {
                stats
                #if INTERNAL
                if let library = model.fixtureLibrary {
                    fixtureLibrarySection(library)
                }
                #endif
                about
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private var stats: some View {
        let stats = model.profileStats
        return Section {
            stat("Recordings", "\(stats.recordings)", id: "stat-recordings")
            stat("Melodic Recordings", "\(stats.melodicRecordings)", id: "stat-melodic")
            stat("Notes collected", "\(stats.notesCollected)", id: "stat-notes")
            stat("Songs unlocked", "\(stats.unlockedSongs) of \(stats.songs)", id: "stat-songs")
            stat("Toots", "\(stats.toots)", id: "stat-toots")
        } header: {
            Text("Stats")
        } footer: {
            if stats.recordings == 0 {
                Text("Record your first fart on the Record tab. Collect notes to unlock Songs.")
                    .accessibilityIdentifier("profile-new-user")
            }
        }
    }

    private var about: some View {
        Section("About") {
            VStack(alignment: .leading, spacing: 2) {
                Text("Songs")
                Text("From public-domain scores in PDMX and the Mutopia Project")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("songs-credit")
            stat("Version", Bundle.main.appVersion, id: "app-version")
        }
    }

    #if INTERNAL
    /// Internal builds only (Debug and QA): add the 23 Fixture Library Recordings as your own.
    private func fixtureLibrarySection(_ library: FixtureLibraryStatus) -> some View {
        Section {
            Button {
                Task { await model.loadFixtureLibrary() }
            } label: {
                HStack {
                    Text(library.isLoading ? "Loading the Fixture Library…" : library.isComplete ? "Fixture Library loaded" : "Load the Fixture Library")
                    Spacer()
                    if library.isLoading {
                        ProgressView()
                    }
                    Text("\(library.loaded) of \(library.total)")
                        .foregroundStyle(.secondary)
                }
            }
            .disabled(library.isLoading || library.isComplete)
            .accessibilityIdentifier("load-fixture-library")
        } header: {
            Text("Internal build")
        } footer: {
            Text("Adds the \(library.total) test farts as your own Recordings, analyzed like real ones. Loading again adds only the missing ones.")
        }
    }
    #endif

    private func stat(_ title: String, _ value: String, id: String) -> some View {
        LabeledContent(title, value: value)
            .accessibilityIdentifier(id)
    }
}

#if DEBUG
#Preview("Profile") {
    ProfileTab(model: SampleAppModel.preview(start: .all, toots: ["mary", "ode"]))
}

#Preview("Profile, new user") {
    ProfileTab(model: SampleAppModel.preview())
}
#endif
