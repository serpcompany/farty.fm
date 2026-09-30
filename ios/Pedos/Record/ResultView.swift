import SwiftUI

/// Result: the note you just made, and what it unlocked.
struct ResultView: View {
    let model: any AppModel
    let recording: Recording
    let changes: CoverageChanges
    let onDone: () -> Void
    let onRecordAnother: () -> Void
    let onTry: (Song) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                header
                if case .analyzed(let analysis) = recording.analysis, analysis.firstFartUsed {
                    VStack(spacing: 4) {
                        Label("We kept the first fart", systemImage: "scissors")
                            .font(.headline)
                        Text("We heard more than one.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                progress
            }
            .padding(20)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(recording.name)
        .safeAreaInset(edge: .bottom) {
            if let unlocked = changes.unlocked.first {
                FlowButtons {
                    Button { finish(then: onDone) } label: { FlowButtonLabel("Done") }
                } primary: {
                    Button { finish { onTry(unlocked) } } label: { FlowButtonLabel("Try it") }
                }
            } else {
                FlowButtons {
                    Button { finish(then: onRecordAnother) } label: { FlowButtonLabel("Record another") }
                } primary: {
                    Button { finish(then: onDone) } label: { FlowButtonLabel("Done") }
                }
            }
        }
    }

    @ViewBuilder
    private var header: some View {
        if let pitch = recording.pitch {
            VStack(spacing: 4) {
                Text("Your note")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Text(Pitch.name(pitch))
                    .font(.system(size: 96, weight: .bold, design: .rounded))
                    .accessibilityIdentifier("result-note")
                PitchStrip(collected: model.collectedPitchClasses, outlined: Pitch.pitchClass(pitch))
                    .padding(.top, 8)
            }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "waveform.path")
                    .font(.system(size: 64))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text("No steady note this time")
                    .font(.title2.bold())
                Text("It's saved, but it can't play melody notes.")
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
        }
    }

    /// Unlocks, then Pitch Coverage that went up, or else the Song closest to unlocking.
    @ViewBuilder
    private var progress: some View {
        VStack(spacing: 12) {
            if changes.unlocked.count > 2 {
                GroupBox {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("You unlocked \(changes.unlocked.count) Songs", systemImage: "lock.open.fill")
                            .font(.headline)
                        Text(changes.unlocked.map(\.title).joined(separator: " · "))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                ForEach(changes.unlocked) { song in
                    GroupBox {
                        Label("You unlocked \(song.title)", systemImage: "lock.open.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            ForEach(changes.improved.prefix(2), id: \.song.id) { entry in
                CoverageCard(entry: entry)
            }
            if changes.unlocked.isEmpty, changes.improved.isEmpty, let closest = changes.closest,
               !model.melodicRecordings.isEmpty {
                CoverageCard(entry: closest)
            }
        }
    }

    private func finish(then action: @escaping () -> Void) {
        model.finishFlow()
        action()
    }
}

/// A Song's Pitch Coverage: its title, a bar, and "3 of 4 notes covered".
private struct CoverageCard: View {
    let entry: CoverageChanges.Entry

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 6) {
                Text(entry.song.title)
                    .font(.headline)
                ProgressView(value: entry.coverage.fraction)
                    .accessibilityHidden(true)
                Text(entry.coverage.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}
