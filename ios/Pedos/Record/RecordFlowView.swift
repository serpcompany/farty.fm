import SwiftUI

/// The full-screen cover over the tabs from the start of a take: Recording, then Review and
/// Result, with their error states.
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
            if model.capture != .idle {
                RecordingView(model: model)
            }
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

#if DEBUG
/// Review and Result, each reached by recording the next story take with the sample model.
private struct RecordFlowPreview: View {
    let model: SampleAppModel
    /// Saves the take after Review opens.
    var saves = true

    var body: some View {
        RecordFlowView(model: model, onDone: {}, onRecordAnother: {}, onTry: { _ in })
            .task {
                await model.previewTake()
                if saves { await model.saveDraft() }
            }
    }
}

#Preview("Review") {
    RecordFlowPreview(model: .preview(), saves: false)
}

#Preview("Save failed") {
    RecordFlowPreview(model: .preview(failures: .saveFailed))
}

#Preview("Result, analyzing") {
    RecordFlowPreview(model: .preview(analysisDelay: .seconds(3600)))
}

#Preview("Result, noise-like") {
    RecordFlowPreview(model: .preview())
}

#Preview("Result, Melodic") {
    RecordFlowPreview(model: .preview(start: .takes(1)))
}

#Preview("Result, first fart kept") {
    RecordFlowPreview(model: .preview(start: .takes(5)))
}

#Preview("Result, unlocked") {
    RecordFlowPreview(model: .preview(start: .takes(7)))
}

#Preview("Analysis failed") {
    RecordFlowPreview(model: .preview(failures: .analysisFailed))
}
#endif
