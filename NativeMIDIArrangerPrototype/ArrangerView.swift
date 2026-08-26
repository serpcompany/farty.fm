import SwiftUI

struct ArrangerRootView: View {
    @Bindable var model: ArrangerModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    questionCard
                    songCard
                    transportCard
                    PianoRollCard(model: model)
                    SelectedNoteCard(model: model)
                    statusCard
                    boundaryCard
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 28)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Pedos Song Maker")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Text("NATIVE PROTOTYPE")
                        .font(.system(size: 8, weight: .bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(.primary.opacity(0.08), in: Capsule())
                }
            }
        }
    }

    private var questionCard: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("THROWAWAY QUESTION")
                .font(.caption2.bold())
                .foregroundStyle(.orange)
            Text("Can a supplied MIDI melody plus native drag-and-drop make fart songs understandable and editable on iPhone?")
                .font(.footnote)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.orange.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(.orange.opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [4])))
    }

    private var songCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("START FROM A SONG")
                .font(.caption2.bold())
                .foregroundStyle(.secondary)
            Picker(
                "Choose a song",
                selection: Binding(
                    get: { model.selectedSongID },
                    set: { model.selectSong(id: $0) }
                )
            ) {
                ForEach(ArrangerModel.songs) { song in
                    Text("\(song.title) — \(song.difficulty)").tag(song.id)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("song-picker")

            HStack(spacing: 11) {
                Image(systemName: "music.note")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(.orange.gradient, in: RoundedRectangle(cornerRadius: 13))
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.selectedSong.title)
                        .font(.title3.bold())
                    Text("\(model.selectedSong.composer) · \(model.events.count) notes · \(Int(model.selectedSong.tempo)) BPM")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(model.assignedCount)/\(model.events.count)")
                    .font(.caption.bold())
                    .padding(7)
                    .background(.orange.opacity(0.12), in: Capsule())
            }
        }
        .cardStyle()
    }

    private var transportCard: some View {
        VStack(spacing: 9) {
            HStack(spacing: 8) {
                Button {
                    model.autoMap()
                } label: {
                    Label("Auto Map", systemImage: "sparkles")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("auto-map")

                Button {
                    model.togglePreview()
                } label: {
                    Label(model.isPlaying ? "Stop" : "Preview", systemImage: model.isPlaying ? "stop.fill" : "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("preview-song")
            }

            HStack(spacing: 8) {
                Button { model.undo() } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                    .disabled(!model.canUndo)
                    .accessibilityIdentifier("undo")
                Button { model.redo() } label: { Label("Redo", systemImage: "arrow.uturn.forward") }
                    .disabled(!model.canRedo)
                    .accessibilityIdentifier("redo")
                Spacer()
                Button { model.addNote() } label: { Label("Add note", systemImage: "plus") }
                    .accessibilityIdentifier("add-note")
            }
            .buttonStyle(.bordered)
            .font(.caption.bold())
        }
        .cardStyle()
    }

    private var statusCard: some View {
        Label(model.statusMessage, systemImage: "waveform.path")
            .font(.caption)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(11)
            .background(.black.opacity(0.86), in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(.white)
            .accessibilityIdentifier("arranger-status")
    }

    private var boundaryCard: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Prototype boundary").bold()
            Text("Editing and bundled-audio preview are functional. Production rendering, MIDI import, saving, and catalog clearance remain separate gates.")
        }
        .font(.caption2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(11)
        .background(.yellow.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.yellow.opacity(0.55)))
    }
}

private struct PianoRollCard: View {
    @Bindable var model: ArrangerModel
    private let pitches = NotePitch.allCases.reversed()

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("PRESS AND DRAG RECORDINGS ONTO NOTES")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.secondary)
                    Text("Arrangement")
                        .font(.headline)
                }
                Spacer()
                Text("Drag notes to swap clips")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            RecordingTray(model: model)

            ScrollView(.horizontal) {
                VStack(spacing: 0) {
                    ForEach(Array(pitches), id: \.self) { pitch in
                        HStack(spacing: 0) {
                            Text(pitch.rawValue)
                                .font(.caption2.bold())
                                .foregroundStyle(.secondary)
                                .frame(width: 40, height: 54)
                                .background(.background)
                            ForEach(Array(model.events.enumerated()), id: \.element.id) { index, event in
                                ZStack {
                                    Rectangle()
                                        .fill(index.isMultiple(of: 2) ? Color.clear : Color.primary.opacity(0.018))
                                    Rectangle()
                                        .stroke(Color.primary.opacity(0.08), lineWidth: 0.5)
                                    if event.pitch == pitch {
                                        NoteBlock(model: model, event: event, index: index)
                                            .padding(4)
                                    }
                                }
                                .frame(width: max(62, event.beats * 62), height: 54)
                            }
                        }
                    }
                }
                .background(.background)
                .clipShape(RoundedRectangle(cornerRadius: 11))
                .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.primary.opacity(0.14)))
            }
            .scrollIndicators(.visible)
            .accessibilityIdentifier("piano-roll")
        }
        .coordinateSpace(name: "arranger-drag")
        .onPreferenceChange(NoteFramePreferenceKey.self) { frames in
            model.updateNoteFrames(frames)
        }
        .overlay(alignment: .topLeading) {
            if let location = model.activeDragLocation {
                DragPreview(
                    title: model.activeDragTitle,
                    subtitle: model.targetedEventID == nil ? "Drag onto a note" : "Release to drop",
                    color: Color(hex: model.activeDragColorHex)
                )
                .fixedSize()
                .position(location)
                .allowsHitTesting(false)
                .zIndex(50)
            }
        }
        .cardStyle()
    }
}

private struct NoteBlock: View {
    @Bindable var model: ArrangerModel
    let event: NoteEvent
    let index: Int
    @State private var isTargeted = false

    private var clip: RecordingClip? { model.clip(id: event.clipID) }
    private var isSelected: Bool { model.selectedEventID == event.id }
    private var isPlaying: Bool { model.playingEventID == event.id }
    private var isCustomTargeted: Bool { model.targetedEventID == event.id }

    var body: some View {
        Button {
            model.select(eventID: event.id)
        } label: {
            HStack(spacing: 4) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(event.pitch.rawValue)
                        .font(.caption2.bold())
                    Text(clip?.name.replacingOccurrences(of: " 0", with: " ") ?? "Drop clip")
                        .font(.system(size: 7))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Text(correctionText)
                    .font(.system(size: 7, weight: .bold))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(noteColor.opacity(isTargeted || isCustomTargeted ? 0.38 : 0.18), in: RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(isTargeted || isCustomTargeted || isSelected ? Color.orange : noteColor, lineWidth: isTargeted || isCustomTargeted ? 3 : 2)
            )
            .scaleEffect(isPlaying ? 1.04 : 1)
            .animation(.snappy(duration: 0.18), value: isPlaying)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Note \(index + 1), \(event.pitch.rawValue), \(clip?.name ?? "unassigned"), \(correctionText)")
        .accessibilityIdentifier("note-\(index + 1)")
        .draggable(ArrangerDragPayload(kind: .note, id: event.id)) {
            DragPreview(title: event.pitch.rawValue, subtitle: clip?.name ?? "Unassigned", color: noteColor)
        }
        .simultaneousGesture(customDragGesture)
        .dropDestination(for: ArrangerDragPayload.self) { payloads, _ in
            guard let payload = payloads.first else { return false }
            return model.handleDrop(payload, on: event.id)
        } isTargeted: { targeted in
            isTargeted = targeted
            model.targetedEventID = targeted ? event.id : nil
        }
        .background {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: NoteFramePreferenceKey.self,
                    value: [event.id: proxy.frame(in: .named("arranger-drag"))]
                )
            }
        }
    }

    private var correctionText: String {
        event.correctionCents == 0 ? "0¢" : "\(event.correctionCents > 0 ? "+" : "")\(event.correctionCents)¢"
    }

    private var noteColor: Color {
        clip.map { Color(hex: $0.colorHex) } ?? .gray
    }

    private var customDragGesture: some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .named("arranger-drag"))
            .onChanged { value in
                model.updateCustomDrag(
                    ArrangerDragPayload(kind: .note, id: event.id),
                    location: value.location
                )
            }
            .onEnded { _ in
                model.finishCustomDrag()
            }
    }
}

private struct RecordingTray: View {
    @Bindable var model: ArrangerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("PRESS AND DRAG ONTO A NOTE")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(.secondary)
            Text("Your recordings")
                .font(.headline)
            ScrollView(.horizontal) {
                HStack(spacing: 9) {
                    ForEach(ArrangerModel.clips) { clip in
                        Button {
                            model.audition(clipID: clip.id)
                        } label: {
                            RecordingCard(clip: clip)
                        }
                        .buttonStyle(.plain)
                            .draggable(ArrangerDragPayload(kind: .clip, id: clip.id)) {
                                DragPreview(title: clip.name, subtitle: clip.detail, color: Color(hex: clip.colorHex))
                            }
                            .accessibilityLabel("\(clip.name), press and drag onto a note")
                            .accessibilityIdentifier("clip-\(clip.id)")
                            .simultaneousGesture(
                                DragGesture(minimumDistance: 8, coordinateSpace: .named("arranger-drag"))
                                    .onChanged { value in
                                        model.updateCustomDrag(
                                            ArrangerDragPayload(kind: .clip, id: clip.id),
                                            location: value.location
                                        )
                                    }
                                    .onEnded { _ in
                                        model.finishCustomDrag()
                                    }
                            )
                    }
                }
            }
            .scrollIndicators(.visible)
        }
    }
}

private struct RecordingCard: View {
    let clip: RecordingClip

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "waveform")
                .font(.title3.bold())
                .foregroundStyle(Color(hex: clip.colorHex))
            VStack(alignment: .leading, spacing: 2) {
                Text(clip.name)
                    .font(.caption.bold())
                Text("\(clip.naturalPitch.rawValue) · \(clip.detail)")
                    .font(.system(size: 8))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(width: 154, alignment: .leading)
        .padding(10)
        .background(Color(hex: clip.colorHex).opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: clip.colorHex).opacity(0.65)))
    }
}

private struct SelectedNoteCard: View {
    @Bindable var model: ArrangerModel

    var body: some View {
        if let event = model.selectedEvent, let index = model.events.firstIndex(where: { $0.id == event.id }) {
            VStack(alignment: .leading, spacing: 11) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("SELECTED NOTE \(index + 1)")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(.secondary)
                        Text("\(event.pitch.rawValue) · \(beatsLabel(event.beats))")
                            .font(.headline)
                    }
                    Spacer()
                    Button { model.auditionSelected() } label: { Label("Hear", systemImage: "play.fill") }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("hear-note")
                }

                HStack(spacing: 8) {
                    Picker("Pitch", selection: Binding(get: { event.pitch }, set: model.setPitch)) {
                        ForEach(NotePitch.allCases) { Text($0.rawValue).tag($0) }
                    }
                    Picker("Length", selection: Binding(get: { event.beats }, set: model.setBeats)) {
                        ForEach([0.5, 1, 1.5, 2], id: \.self) { Text(beatsLabel($0)).tag($0) }
                    }
                    Picker("Accent", selection: Binding(get: { event.accent }, set: model.setAccent)) {
                        ForEach(NoteAccent.allCases) { Text($0.rawValue.capitalized).tag($0) }
                    }
                }
                .pickerStyle(.menu)
                .font(.caption)

                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text("Pitch correction")
                        Spacer()
                        Text("\(event.correctionCents)¢").bold()
                    }
                    .font(.caption2)
                    Slider(
                        value: Binding(
                            get: { Double(event.correctionCents) },
                            set: { model.setCorrection(Int($0.rounded())) }
                        ),
                        in: -50...50,
                        step: 1
                    )
                    .accessibilityIdentifier("pitch-correction")
                }

                sourceRow(event)

                HStack(spacing: 7) {
                    Button { model.moveSelected(by: -1) } label: { Image(systemName: "arrow.left") }
                        .disabled(index == 0)
                        .accessibilityIdentifier("move-left")
                    Button { model.moveSelected(by: 1) } label: { Image(systemName: "arrow.right") }
                        .disabled(index == model.events.count - 1)
                        .accessibilityIdentifier("move-right")
                    Button("Duplicate") { model.duplicateSelected() }
                        .accessibilityIdentifier("duplicate-note")
                    Spacer()
                    Menu {
                        Button("Remove recording") { model.removeClipFromSelected() }
                        Button("Delete MIDI note", role: .destructive) { model.deleteSelected() }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityIdentifier("note-actions")
                }
                .buttonStyle(.bordered)
                .font(.caption.bold())
            }
            .cardStyle()
        }
    }

    private func sourceRow(_ event: NoteEvent) -> some View {
        let clip = model.clip(id: event.clipID)
        return HStack(spacing: 8) {
            Circle()
                .fill(clip.map { Color(hex: $0.colorHex) } ?? .gray)
                .frame(width: 11, height: 11)
            VStack(alignment: .leading, spacing: 1) {
                Text("SOURCE RECORDING")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(.secondary)
                Text(clip?.name ?? "No recording assigned")
                    .font(.caption.bold())
            }
            Spacer()
            Text(clip?.detail ?? "Drop one above")
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
        }
        .padding(9)
        .background(.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
    }

    private func beatsLabel(_ beats: Double) -> String {
        "\(beats.formatted()) beat\(beats == 1 ? "" : "s")"
    }
}

private struct DragPreview: View {
    let title: String
    let subtitle: String
    let color: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "hand.draw.fill")
                .foregroundStyle(color)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption.bold())
                Text(subtitle).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(color, lineWidth: 2))
    }
}

private struct NoteFramePreferenceKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]

    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, latest in latest })
    }
}

private extension View {
    func cardStyle() -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.background, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.primary.opacity(0.09)))
    }
}

private extension Color {
    init(hex: UInt) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

#Preview("Native arranger") {
    ArrangerRootView(model: ArrangerModel())
        .tint(.orange)
}
