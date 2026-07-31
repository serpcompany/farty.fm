import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    let recorder: RecorderStore

    var body: some View {
        NavigationStack {
            List {
                captureSection
                stateSection
                proofControlsSection
                recordingsSection
            }
            .navigationTitle("Analysis Proof")
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
            LabeledContent("Fresh analyses this launch", value: "\(recorder.analysisExecutionsThisLaunch)")
            LabeledContent("Preserved analyses", value: "\(preservedAnalysisCount)")
            LabeledContent("Storage") {
                Text("Recordings + separate RecordingAnalysis JSON")
                    .multilineTextAlignment(.trailing)
            }
        }
    }

    private var proofControlsSection: some View {
        Section {
            Button("Install 3 controlled analysis cases") {
                recorder.installProofCases()
            }
            .accessibilityIdentifier("install-analysis-cases")

            Button("Analyze every missing Recording") {
                recorder.analyzeMissing()
            }
            .accessibilityIdentifier("analyze-missing")

            Button("Forget preserved analysis", role: .destructive) {
                recorder.forgetAllAnalysis()
            }
        } header: {
            Text("Prototype controls")
        } footer: {
            Text("The controlled cases are bundled proof inputs, not a regular-user starter library.")
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
                        analysisStatus: recorder.analysisStatus(for: recording),
                        isPlaying: recorder.playingURL == recording.url,
                        onPlay: { recorder.togglePlayback(of: recording) },
                        onAnalyze: { recorder.analyze(recording) },
                        onDelete: { recorder.delete(recording) }
                    )
                }
            }
        }
    }

    private var preservedAnalysisCount: Int {
        recorder.recordings.reduce(into: 0) { count, recording in
            if case .ready(_, source: .preserved) = recorder.analysisStatus(for: recording) {
                count += 1
            }
        }
    }
}

private struct RecordingRow: View {
    let recording: Recording
    let analysisStatus: RecordingAnalysisStatus
    let isPlaying: Bool
    let onPlay: () -> Void
    let onAnalyze: () -> Void
    let onDelete: () -> Void

    @State private var confirmsDeletion = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading) {
                    Text(recording.url.lastPathComponent)
                        .font(.headline)
                        .lineLimit(1)
                    Text("\(recording.duration, format: .number.precision(.fractionLength(2))) seconds")
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

            analysisView
        }
        .padding(.vertical, 4)
        .confirmationDialog(
            "Delete this Recording?",
            isPresented: $confirmsDeletion,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive, action: onDelete)
            Button("Cancel", role: .cancel) {}
        }
    }

    @ViewBuilder
    private var analysisView: some View {
        switch analysisStatus {
        case .missing:
            HStack {
                Label("Recording Analysis missing", systemImage: "questionmark.circle")
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Analyze", action: onAnalyze)
                    .buttonStyle(.borderedProminent)
            }

        case .analyzing:
            HStack {
                ProgressView()
                Text("Analyzing saved audio…")
            }

        case let .failed(message):
            VStack(alignment: .leading) {
                Label("Analysis failed", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                Text(message)
                    .font(.caption)
                Button("Retry", action: onAnalyze)
            }

        case let .ready(analysis, source):
            VStack(alignment: .leading, spacing: 4) {
                Label(source.rawValue, systemImage: source == .fresh ? "sparkles" : "doc.text")
                    .font(.subheadline.bold())
                analysisLine("Usable", "\(analysis.usableDurationSeconds.formatted(.number.precision(.fractionLength(2)))) s from \(analysis.usableStartSeconds.formatted(.number.precision(.fractionLength(2)))) s")
                analysisLine("Level", "\(analysis.rmsDBFS.formatted(.number.precision(.fractionLength(1)))) dBFS RMS · \(analysis.peakDBFS.formatted(.number.precision(.fractionLength(1)))) dBFS peak")
                analysisLine("Brightness", analysis.brightness.formatted(.number.precision(.fractionLength(2))))
                analysisLine(
                    "Pitch",
                    "\(analysis.referenceNoteLabel) · confidence \(analysis.pitchConfidence.formatted(.percent.precision(.fractionLength(0)))) · voiced \(analysis.pitchedFrameRatio.formatted(.percent.precision(.fractionLength(0))))"
                )
                Text("v\(analysis.version) · \(analysis.audioRevision)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func analysisLine(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .multilineTextAlignment(.trailing)
        }
        .font(.caption)
    }
}
