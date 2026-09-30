import SwiftUI

/// Profile: what you've collected and made, where the Songs come from, and the app version.
/// Everything is counted from what's on the phone; there's no account or sign-in (ADR 0001).
struct ProfileTab: View {
    let model: any AppModel

    var body: some View {
        NavigationStack {
            List {
                stats
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
