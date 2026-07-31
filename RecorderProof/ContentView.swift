import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    let recorder: RecorderStore

    var body: some View {
        NavigationStack {
            List {
                captureSection
                stateSection
                recordingsSection
            }
            .navigationTitle("Recorder Proof")
            .alert(
                "Prototype problem",
                isPresented: Binding(
                    get: { recorder.errorMessage != nil },
                    set: { if !$0 { recorder.errorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) {
                    recorder.errorMessage = nil
                }
            } message: {
                Text(recorder.errorMessage ?? "")
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase != .active {
                recorder.finishCaptureIfNeeded()
            }
        }
    }

    @ViewBuilder
    private var captureSection: some View {
        Section {
            switch recorder.phase {
            case .idle:
                Button {
                    Task { await recorder.startRecording() }
                } label: {
                    Label("Capture one fart", systemImage: "record.circle")
                        .frame(maxWidth: .infinity, minHeight: 64)
                        .font(.title3.bold())
                }
                .accessibilityIdentifier("start-recording")

            case let .recording(startedAt):
                VStack(spacing: 14) {
                    TimelineView(.periodic(from: startedAt, by: 0.2)) { context in
                        Text(context.date.timeIntervalSince(startedAt), format: .number.precision(.fractionLength(1)))
                            .font(.system(.title, design: .monospaced, weight: .bold))
                            .contentTransition(.numericText())
                    }
                    Label("RECORDING", systemImage: "waveform")
                        .foregroundStyle(.red)
                        .font(.headline)
                    Button("Stop and review", role: .destructive) {
                        recorder.stopRecording()
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("stop-recording")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)

            case let .reviewing(draft):
                VStack(alignment: .leading, spacing: 12) {
                    Label("Unsaved Recording", systemImage: "waveform.badge.magnifyingglass")
                        .font(.headline)
                    Text("Captured \(draft.duration, format: .number.precision(.fractionLength(1))) seconds")
                        .foregroundStyle(.secondary)
                    HStack {
                        Button(recorder.playingURL == draft.url ? "Stop preview" : "Preview") {
                            recorder.previewDraft()
                        }
                        .buttonStyle(.bordered)

                        Button("Save") {
                            recorder.saveDraft()
                        }
                        .buttonStyle(.borderedProminent)

                        Button("Discard", role: .destructive) {
                            recorder.discardDraft()
                        }
                    }
                }
                .padding(.vertical, 8)
            }
        } header: {
            Text("Capture Dock")
        } footer: {
            Text("Capture and persistence are intentionally independent from Recording Analysis.")
        }
    }

    private var stateSection: some View {
        Section("Visible prototype state") {
            LabeledContent("Phase", value: recorder.phase.label)
            LabeledContent("Draft", value: recorder.draftFilename)
            LabeledContent("Saved count", value: "\(recorder.recordings.count)")
            LabeledContent("Storage") {
                Text("Application Support/Recordings")
                    .multilineTextAlignment(.trailing)
            }
        }
    }

    @ViewBuilder
    private var recordingsSection: some View {
        Section("Recording shelf") {
            if recorder.recordings.isEmpty {
                ContentUnavailableView(
                    "No Recordings",
                    systemImage: "waveform",
                    description: Text("Capture, preview, and save your first Recording.")
                )
            } else {
                ForEach(recorder.recordings) { recording in
                    RecordingRow(
                        recording: recording,
                        isPlaying: recorder.playingURL == recording.url,
                        onPlay: { recorder.togglePlayback(of: recording) },
                        onDelete: { recorder.delete(recording) }
                    )
                }
            }
        }
    }
}

private struct RecordingRow: View {
    let recording: Recording
    let isPlaying: Bool
    let onPlay: () -> Void
    let onDelete: () -> Void

    @State private var confirmsDeletion = false

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(recording.createdAt, format: .dateTime.month().day().hour().minute())
                    .font(.headline)
                Text("\(recording.duration, format: .number.precision(.fractionLength(1))) seconds")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(action: onPlay) {
                Image(systemName: isPlaying ? "stop.fill" : "play.fill")
            }
            .buttonStyle(.bordered)
            .accessibilityLabel(isPlaying ? "Stop Recording playback" : "Play Recording")

            Button(role: .destructive) {
                confirmsDeletion = true
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Delete Recording")
        }
        .confirmationDialog(
            "Delete this Recording?",
            isPresented: $confirmsDeletion,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive, action: onDelete)
            Button("Cancel", role: .cancel) {}
        }
    }
}
