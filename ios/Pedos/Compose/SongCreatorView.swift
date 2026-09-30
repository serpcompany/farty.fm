import SwiftUI

/// Song Creator: hear an Unlocked Song played by your Recordings, and keep it. It's not an
/// editor: nothing here changes the Arrangement (ADR 0005).
struct SongCreatorView: View {
    let model: any AppModel
    let song: Song

    @State private var phase = Phase.making
    /// Bumped by Try again, to make the melody again.
    @State private var attempt = 0

    private enum Phase: Equatable {
        case making
        case ready(MelodyDraft)
        case failed
    }

    var body: some View {
        content
            .navigationTitle(song.title)
            .navigationSubtitle(song.source)
            .navigationBarTitleDisplayMode(.inline)
            .task(id: attempt) { await make() }
            .onDisappear { model.stopPlayback() }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .making:
            ProgressView("Making your melody…")
                .controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready(let draft):
            ready(draft)
        case .failed:
            ContentUnavailableView {
                Label("Couldn't make this melody", systemImage: "exclamationmark.triangle")
            } actions: {
                Button("Try again") {
                    phase = .making
                    attempt += 1
                }
                .buttonStyle(.bordered)
            }
        }
    }

    /// Makes the melody once, then plays it once. Coming back to the tab doesn't make it again.
    private func make() async {
        guard phase == .making else { return }
        do {
            let draft = try await model.makeMelody(of: song)
            phase = .ready(draft)
            // Only while the screen is still showing.
            if !Task.isCancelled { model.togglePlayback(of: .melodyDraft(draft.id)) }
        } catch is CancellationError {
            // Left before it was made; it's made again on the way back.
        } catch {
            if !Task.isCancelled { phase = .failed }
        }
    }

    private func ready(_ draft: MelodyDraft) -> some View {
        let isPlaying = model.nowPlaying == .melodyDraft(draft.id)
        let isSaved = model.melody(draft.id) != nil
        // Each Recording with its place in the Arrangement, which picks its note color.
        let recordings = draft.arrangement.recordings.enumerated().compactMap { index, id in
            model.recording(id).map { (index: index, recording: $0) }
        }
        return ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 16) {
                    Button {
                        model.togglePlayback(of: .melodyDraft(draft.id))
                    } label: {
                        Image(systemName: isPlaying ? "stop.circle.fill" : "play.circle.fill")
                            .font(.system(size: 56))
                            .symbolRenderingMode(.hierarchical)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tint)
                    .accessibilityLabel(isPlaying ? "Stop" : "Play")
                    .accessibilityIdentifier("song-creator-play")
                    VStack(alignment: .leading, spacing: 2) {
                        Text(isPlaying ? "Playing" : "Ready")
                            .font(.headline)
                        Text("\(recordings.count) of your Recordings, one per note")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                NoteView(
                    song: song,
                    arrangement: draft.arrangement,
                    startedAt: isPlaying ? model.playbackStartedAt : nil
                )
                .frame(height: 180)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Recordings used")
                        .font(.headline)
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(recordings, id: \.recording.id) { index, recording in
                                RecordingChip(
                                    recording: recording,
                                    color: NoteView.color(forRecordingAt: index),
                                    isPlaying: model.nowPlaying == .recording(recording.id)
                                ) {
                                    model.togglePlayback(of: .recording(recording.id))
                                }
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                    .scrollClipDisabled()
                }

                #if DEBUG
                if let source = model.simulatedSource(ofMelody: draft.id) {
                    Text("Simulated melody: \(source), not made from these Recordings.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                #endif
            }
            .padding(20)
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                model.saveMelody(draft)
            } label: {
                Group {
                    if isSaved {
                        Label("Saved to Melodies", systemImage: "checkmark")
                    } else {
                        Text("Save to Melodies")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isSaved)
            .sensoryFeedback(.success, trigger: isSaved)
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
    }
}

/// A Recording the Arrangement uses, in its note color. Tap to hear that fart alone.
private struct RecordingChip: View {
    let recording: Recording
    let color: Color
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: isPlaying ? "stop.fill" : "circle.fill")
                    .imageScale(.small)
                    .foregroundStyle(color)
                Text(recording.name)
                if let pitch = recording.pitch {
                    Text(Pitch.name(pitch))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(recording.name)
        .accessibilityValue([recording.pitch.map(Pitch.name), isPlaying ? "playing" : nil].compactMap { $0 }.joined(separator: ", "))
        .accessibilityHint(isPlaying ? "Stops playing" : "Plays this Recording alone")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("chip \(recording.name)")
    }
}

#if DEBUG
#Preview("Song Creator") {
    let model = SampleAppModel.preview(start: .all, makingDelay: .zero)
    NavigationStack {
        SongCreatorView(model: model, song: model.song("mary")!)
    }
}

#Preview("Song Creator, making") {
    let model = SampleAppModel.preview(start: .all, makingDelay: .seconds(3600))
    NavigationStack {
        SongCreatorView(model: model, song: model.song("mary")!)
    }
}

#Preview("Song Creator, couldn't make") {
    let model = SampleAppModel.preview(start: .all, failures: .couldNotMakeMelody, makingDelay: .zero)
    NavigationStack {
        SongCreatorView(model: model, song: model.song("mary")!)
    }
}
#endif
