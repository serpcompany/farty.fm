import SwiftUI

/// Song Creator: hear an Unlocked Song played by your Recordings, and keep it as a Toot. It's not
/// an editor: nothing here changes the Arrangement (ADR 0005).
struct SongCreatorView: View {
    let model: any AppModel
    let song: Song

    @State private var phase = Phase.making
    /// Bumped by Try again, to make the Toot again.
    @State private var attempt = 0

    private enum Phase: Equatable {
        case making
        case ready(TootDraft)
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
            ProgressView("Making your Toot…")
                .controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready(let draft):
            ready(draft)
        case .failed:
            ContentUnavailableView {
                Label("Couldn't make this Toot", systemImage: "exclamationmark.triangle")
            } actions: {
                Button("Try again") {
                    phase = .making
                    attempt += 1
                }
                .buttonStyle(.bordered)
            }
        }
    }

    /// Makes the Toot once, then plays it once. Coming back to the tab doesn't make it again.
    private func make() async {
        guard phase == .making else { return }
        do {
            let draft = try await model.makeToot(of: song)
            phase = .ready(draft)
            // Only while the screen is still showing.
            if !Task.isCancelled { model.togglePlayback(of: .tootDraft(draft.id)) }
        } catch is CancellationError {
            // Left before it was made; it's made again on the way back.
        } catch {
            if !Task.isCancelled { phase = .failed }
        }
    }

    private func ready(_ draft: TootDraft) -> some View {
        let isSaved = model.toot(draft.id) != nil
        return TootLayout(model: model, song: song, arrangement: draft.arrangement, tootID: draft.id, item: .tootDraft(draft.id)) {
            EmptyView()
        }
        // Pinned under the list, with the system's scroll edge effect behind it.
        .safeAreaBar(edge: .bottom) {
            Button {
                model.saveToot(draft)
            } label: {
                Group {
                    if isSaved {
                        Label("Saved to Toots", systemImage: "checkmark")
                    } else {
                        Text("Save to Toots")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isSaved)
            .sensoryFeedback(.success, trigger: isSaved) { _, saved in saved }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
    }
}

#if DEBUG
#Preview("Song Creator") {
    let model = SampleAppModel.preview(start: .all, minimumMakingTime: .zero)
    NavigationStack {
        SongCreatorView(model: model, song: model.song("mary")!)
    }
}

#Preview("Song Creator, making") {
    let model = SampleAppModel.preview(start: .all, minimumMakingTime: .seconds(3600))
    NavigationStack {
        SongCreatorView(model: model, song: model.song("mary")!)
    }
}

#Preview("Song Creator, couldn't make") {
    let model = SampleAppModel.preview(start: .all, failures: .couldNotMakeToot, minimumMakingTime: .zero)
    NavigationStack {
        SongCreatorView(model: model, song: model.song("mary")!)
    }
}
#endif
