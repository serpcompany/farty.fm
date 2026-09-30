import SwiftUI

/// What a locked Song still needs: its Pitch Coverage, the missing notes with their octave, and
/// the pitch strip with the needed pitch classes marked. A locked Song can't be played.
struct LockedSongSheet: View {
    let model: any AppModel
    let song: Song
    /// Record: closes the sheet and switches to the Record tab.
    let onRecord: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let coverage = model.coverage(of: song)
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView(value: coverage.fraction)
                        .accessibilityHidden(true)
                    Label(coverage.summary, systemImage: "lock.fill")
                        .foregroundStyle(.secondary)
                }
                PitchStrip(collected: model.collectedPitchClasses, needed: Set(coverage.missing.map { Pitch.pitchClass(Double($0)) }))
                Text(needs(coverage))
                    .font(.title3)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("locked-song-needs")
                Spacer(minLength: 0)
                Button(action: onRecord) {
                    Text("Record").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .accessibilityIdentifier("locked-song-record")
            }
            .padding(20)
            .navigationTitle(song.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .close) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }

    /// "Needs a fart near D3 and F3.", or how to start without Melodic Recordings.
    private func needs(_ coverage: CoverageResult) -> String {
        guard coverage.hasMelodicRecordings, let missing = coverage.missingNotes() else {
            return "Record a fart with a clear note to start."
        }
        return "Needs a fart near \(missing)."
    }
}

#if DEBUG
#Preview("Locked Song") {
    let model = SampleAppModel.preview(start: .all)
    Color.clear.sheet(isPresented: .constant(true)) {
        LockedSongSheet(model: model, song: model.song("birthday")!, onRecord: {})
    }
}

#Preview("Locked Song, no Melodic Recordings") {
    let model = SampleAppModel.preview()
    Color.clear.sheet(isPresented: .constant(true)) {
        LockedSongSheet(model: model, song: model.song("mary")!, onRecord: {})
    }
}
#endif
