import SwiftUI

/// The full-screen cover after a take: Review, then Result, with their error states.
struct RecordFlowView: View {
    let model: any AppModel
    /// Done: close and show the Recordings tab.
    let onDone: () -> Void
    /// Record another: close and show the Record tab.
    let onRecordAnother: () -> Void
    /// Try it: close and open the unlocked Song.
    let onTry: (Song) -> Void

    var body: some View {
        NavigationStack {
            content
                .navigationBarTitleDisplayMode(.inline)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.flow {
        case .review(let draft):
            ReviewView(model: model, draft: draft)
        case .saveFailed:
            SaveFailedView(model: model)
        case .analyzing(let id):
            ProgressView("Finding your note…")
                .controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .navigationTitle(model.recording(id)?.name ?? "")
        case .analysisFailed(let id):
            AnalysisFailedView(model: model, recordingID: id, onDone: onDone)
        case .result(let result):
            if let recording = model.recording(result.recordingID) {
                ResultView(
                    model: model,
                    recording: recording,
                    changes: result.changes,
                    onDone: onDone,
                    onRecordAnother: onRecordAnother,
                    onTry: onTry
                )
            }
        case nil:
            EmptyView()
        }
    }
}

/// Primary and secondary buttons pinned to the bottom of a flow step.
struct FlowButtons<Secondary: View, Primary: View>: View {
    @ViewBuilder let secondary: Secondary
    @ViewBuilder let primary: Primary

    var body: some View {
        HStack(spacing: 12) {
            secondary
                .buttonStyle(.bordered)
            primary
                .buttonStyle(.borderedProminent)
        }
        .controlSize(.large)
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
    }
}

/// A full-width button title for `FlowButtons`.
struct FlowButtonLabel: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title).frame(maxWidth: .infinity)
    }
}

/// "Couldn't save this Recording", with Try again and Discard.
private struct SaveFailedView: View {
    let model: any AppModel

    var body: some View {
        ContentUnavailableView("Couldn't save this Recording", systemImage: "exclamationmark.triangle")
            .navigationTitle("New Recording")
            .safeAreaInset(edge: .bottom) {
                FlowButtons {
                    Button { model.discardDraft() } label: { FlowButtonLabel("Discard") }
                } primary: {
                    Button { Task { await model.saveDraft() } } label: { FlowButtonLabel("Try again") }
                }
            }
    }
}

/// "Saved, but we couldn't find its note", with Retry. The Recording stays on the Recordings tab
/// as not analyzed.
private struct AnalysisFailedView: View {
    let model: any AppModel
    let recordingID: Recording.ID
    let onDone: () -> Void

    var body: some View {
        ContentUnavailableView(
            "Saved, but we couldn't find its note",
            systemImage: "questionmark.circle",
            description: Text("It's on the Recordings tab as not analyzed.")
        )
        .navigationTitle(model.recording(recordingID)?.name ?? "")
        .safeAreaInset(edge: .bottom) {
            FlowButtons {
                Button {
                    model.finishFlow()
                    onDone()
                } label: { FlowButtonLabel("Done") }
            } primary: {
                Button { Task { await model.retryAnalysis(of: recordingID) } } label: { FlowButtonLabel("Retry") }
            }
        }
    }
}
