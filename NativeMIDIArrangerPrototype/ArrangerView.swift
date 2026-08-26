import SwiftUI

enum StudioPalette {
    static let background = Color(red: 0.035, green: 0.043, blue: 0.063)
    static let surface = Color(red: 0.067, green: 0.078, blue: 0.106)
    static let raised = Color(red: 0.092, green: 0.106, blue: 0.141)
    static let grid = Color.white.opacity(0.085)
    static let gridStrong = Color.white.opacity(0.15)
    static let accent = Color(red: 1.0, green: 0.48, blue: 0.24)
    static let accentSecondary = Color(red: 1.0, green: 0.72, blue: 0.29)
    static let mutedText = Color.white.opacity(0.58)
}

private enum StudioMetrics {
    static let screenPadding: CGFloat = 14
    static let pitchLabelWidth: CGFloat = 42
    static let rowHeight: CGFloat = 52
    static let minimumBeatWidth: CGFloat = 58
}

private struct InspectorSelection: Identifiable {
    let id: String
}

struct ArrangerRootView: View {
    @Bindable var model: ArrangerModel
    @State private var inspectorSelection: InspectorSelection?

    var body: some View {
        StudioWorkspace(model: model) {
            guard let selectedEventID = model.selectedEventID else { return }
            inspectorSelection = InspectorSelection(id: selectedEventID)
        }
        .sheet(item: $inspectorSelection) { selection in
            NoteInspectorSheet(model: model, eventID: selection.id)
                .presentationDetents([.height(410), .large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(30)
        }
        .preferredColorScheme(.dark)
    }
}

private struct StudioWorkspace: View {
    @Bindable var model: ArrangerModel
    let openInspector: () -> Void

    var body: some View {
        ZStack {
            StudioPalette.background
                .ignoresSafeArea()

            VStack(spacing: 0) {
                StudioHeader(model: model)

                Divider()
                    .overlay(StudioPalette.grid)

                RecordingShelf(model: model)

                PianoRollStage(model: model)
                    .frame(maxHeight: .infinity)

                SelectedNoteDock(model: model, openInspector: openInspector)
            }
        }
        .coordinateSpace(.named("arranger-drag"))
        .onPreferenceChange(NoteFramePreferenceKey.self, perform: model.updateNoteFrames)
        .overlay(alignment: .topLeading) {
            if let location = model.activeDragLocation {
                DragPreview(
                    title: model.activeDragTitle,
                    subtitle: model.targetedEventID == nil ? "Find a note" : "Release to assign",
                    color: Color(hex: model.activeDragColorHex)
                )
                .fixedSize()
                .position(location)
                .allowsHitTesting(false)
                .zIndex(50)
            }
        }
        .sensoryFeedback(.selection, trigger: model.selectedEventID)
    }
}

private struct StudioHeader: View {
    @Bindable var model: ArrangerModel

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 9) {
                SongMenu(model: model)

                Spacer(minLength: 2)

                HeaderIconButton(
                    title: "Undo",
                    systemImage: "arrow.uturn.backward",
                    isEnabled: model.canUndo,
                    identifier: "undo",
                    action: model.undo
                )

                HeaderIconButton(
                    title: "Redo",
                    systemImage: "arrow.uturn.forward",
                    isEnabled: model.canRedo,
                    identifier: "redo",
                    action: model.redo
                )

                Button(action: model.togglePreview) {
                    Image(systemName: model.isPlaying ? "stop.fill" : "play.fill")
                        .font(.headline.weight(.bold))
                        .frame(width: 44, height: 44)
                        .background(StudioPalette.accent.gradient, in: Circle())
                        .foregroundStyle(.white)
                        .shadow(color: StudioPalette.accent.opacity(0.32), radius: 10, y: 4)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(model.isPlaying ? "Stop preview" : "Preview song")
                .accessibilityIdentifier("preview-song")
            }

            HStack(spacing: 9) {
                Button(action: model.autoMap) {
                    Label("Auto Map", systemImage: "wand.and.stars")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background(
                            LinearGradient(
                                colors: [StudioPalette.accent.opacity(0.24), StudioPalette.accentSecondary.opacity(0.12)],
                                startPoint: .leading,
                                endPoint: .trailing
                            ),
                            in: Capsule()
                        )
                        .overlay(Capsule().strokeBorder(StudioPalette.accent.opacity(0.7)))
                }
                .buttonStyle(.plain)
                .accessibilityHint("Matches a recording to every MIDI note")
                .accessibilityIdentifier("auto-map")

                Button(action: model.addNote) {
                    Label("Add Note", systemImage: "plus")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 15)
                        .frame(height: 36)
                        .background(StudioPalette.raised, in: Capsule())
                        .overlay(Capsule().strokeBorder(StudioPalette.gridStrong))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("add-note")
            }

            Label(model.statusMessage, systemImage: "waveform.path")
                .font(.caption)
                .foregroundStyle(StudioPalette.mutedText)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("arranger-status")
        }
        .padding(.horizontal, StudioMetrics.screenPadding)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }
}

private struct SongMenu: View {
    @Bindable var model: ArrangerModel

    var body: some View {
        Menu {
            ForEach(ArrangerModel.songs) { song in
                Button {
                    model.selectSong(id: song.id)
                } label: {
                    Label(
                        song.title,
                        systemImage: song.id == model.selectedSongID ? "checkmark.circle.fill" : "music.note"
                    )
                }
            }
        } label: {
            HStack(spacing: 9) {
                Image(systemName: "music.note.list")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(StudioPalette.accentSecondary)
                    .frame(width: 34, height: 34)
                    .background(StudioPalette.raised, in: .rect(cornerRadius: 10))

                VStack(alignment: .leading, spacing: 1) {
                    Text(model.selectedSong.title)
                        .font(.headline)
                        .lineLimit(1)
                    Text("\(Int(model.selectedSong.tempo)) BPM · \(model.events.count) notes")
                        .font(.caption)
                        .foregroundStyle(StudioPalette.mutedText)
                        .lineLimit(1)
                }

                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(StudioPalette.mutedText)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Song, \(model.selectedSong.title)")
        .accessibilityHint("Choose one of four song templates")
        .accessibilityIdentifier("song-picker")
    }
}

private struct HeaderIconButton: View {
    let title: String
    let systemImage: String
    let isEnabled: Bool
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.semibold))
                .frame(width: 36, height: 36)
                .background(StudioPalette.raised, in: Circle())
                .overlay(Circle().strokeBorder(StudioPalette.grid))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.34)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

private struct RecordingShelf: View {
    @Bindable var model: ArrangerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Your sounds", systemImage: "waveform.badge.mic")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                Label("Drag to a note", systemImage: "hand.draw")
                    .font(.caption)
                    .foregroundStyle(StudioPalette.mutedText)
            }
            .padding(.horizontal, StudioMetrics.screenPadding)

            ScrollView(.horizontal) {
                LazyHStack(spacing: 9) {
                    ForEach(ArrangerModel.clips) { clip in
                        RecordingClipButton(model: model, clip: clip)
                    }
                }
                .padding(.horizontal, StudioMetrics.screenPadding)
            }
            .frame(height: 80)
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
        .padding(.vertical, 10)
        .background(StudioPalette.surface.opacity(0.72))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Recording shelf")
    }
}

private struct RecordingClipButton: View {
    @Bindable var model: ArrangerModel
    let clip: RecordingClip

    var body: some View {
        Button {
            model.audition(clipID: clip.id)
        } label: {
            RecordingClipCard(clip: clip)
        }
        .buttonStyle(.plain)
        .draggable(ArrangerDragPayload(kind: .clip, id: clip.id)) {
            DragPreview(title: clip.name, subtitle: clip.detail, color: Color(hex: clip.colorHex))
        }
        .simultaneousGesture(customDragGesture)
        .accessibilityLabel("\(clip.name), natural pitch \(clip.naturalPitch.rawValue)")
        .accessibilityHint("Double tap to preview, or drag onto a note")
        .accessibilityIdentifier("clip-\(clip.id)")
    }

    private var customDragGesture: some Gesture {
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
    }
}

private struct RecordingClipCard: View {
    let clip: RecordingClip

    var body: some View {
        let color = Color(hex: clip.colorHex)

        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .center, spacing: 7) {
                MiniWaveform(color: color, seed: clip.naturalPitch.midi)

                Text(clip.naturalPitch.rawValue)
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(color)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(color.opacity(0.14), in: Capsule())
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(clip.name)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text(clip.detail)
                    .font(.caption2)
                    .foregroundStyle(StudioPalette.mutedText)
                    .lineLimit(1)
            }
        }
        .frame(width: 124, alignment: .leading)
        .padding(10)
        .background(
            LinearGradient(
                colors: [color.opacity(0.16), StudioPalette.raised],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(.white.opacity(0.035), in: .rect(cornerRadius: 14))
        .compositingGroup()
        .clipShape(.rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(color.opacity(0.38)))
    }
}

private struct MiniWaveform: View {
    let color: Color
    let seed: Int

    private let multipliers: [CGFloat] = [0.35, 0.72, 0.48, 0.95, 0.62, 0.82, 0.42]

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(Array(multipliers.enumerated()), id: \.offset) { index, multiplier in
                Capsule()
                    .fill(color.gradient)
                    .frame(width: 2.5, height: 20 * adjusted(multiplier, at: index))
            }
        }
        .frame(height: 22)
        .accessibilityHidden(true)
    }

    private func adjusted(_ value: CGFloat, at index: Int) -> CGFloat {
        (seed + index).isMultiple(of: 3) ? value * 0.78 : value
    }
}

private struct PianoRollStage: View {
    @Bindable var model: ArrangerModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("ARRANGEMENT")
                        .font(.caption2.weight(.bold))
                        .tracking(1.1)
                        .foregroundStyle(StudioPalette.accentSecondary)
                    Text(model.selectedSong.composer)
                        .font(.caption)
                        .foregroundStyle(StudioPalette.mutedText)
                }

                Spacer()

                Text("\(model.assignedCount)/\(model.events.count) mapped")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(StudioPalette.mutedText)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 9)

            HStack(spacing: 0) {
                PitchLabels()

                ScrollView(.horizontal) {
                    VStack(spacing: 0) {
                        TimelineRuler(events: model.events)

                        ForEach(NotePitch.allCases.reversed(), id: \.self) { pitch in
                            PitchTimelineRow(model: model, pitch: pitch)
                        }
                    }
                }
                .scrollIndicators(.visible)
                .scrollBounceBehavior(.basedOnSize)
            }
            .background(StudioPalette.background.opacity(0.75))
            .compositingGroup()
            .clipShape(.rect(cornerRadius: 15))
            .overlay(RoundedRectangle(cornerRadius: 15).strokeBorder(StudioPalette.gridStrong))
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Piano roll with \(model.events.count) notes")
            .accessibilityIdentifier("piano-roll")
        }
        .background(StudioPalette.surface)
    }
}

private struct PitchLabels: View {
    var body: some View {
        VStack(spacing: 0) {
            Text("NOTE")
                .font(.caption2.weight(.bold))
                .tracking(0.6)
                .foregroundStyle(StudioPalette.mutedText)
                .frame(width: StudioMetrics.pitchLabelWidth, height: 24)
                .background(StudioPalette.raised)

            ForEach(NotePitch.allCases.reversed(), id: \.self) { pitch in
                Text(pitch.rawValue)
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(.white.opacity(0.78))
                    .frame(width: StudioMetrics.pitchLabelWidth, height: StudioMetrics.rowHeight)
                    .background(StudioPalette.raised.opacity(pitch.midi.isMultiple(of: 2) ? 0.72 : 0.92))
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(StudioPalette.grid)
                            .frame(height: 0.5)
                    }
            }
        }
    }
}

private struct TimelineRuler: View {
    let events: [NoteEvent]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                Text("\(index + 1)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(index.isMultiple(of: 4) ? .white.opacity(0.7) : StudioPalette.mutedText)
                    .frame(width: cellWidth(for: event), height: 24, alignment: .leading)
                    .padding(.leading, 5)
                    .background(index.isMultiple(of: 4) ? StudioPalette.grid : .clear)
            }
        }
        .background(StudioPalette.raised.opacity(0.82))
    }
}

private struct PitchTimelineRow: View {
    @Bindable var model: ArrangerModel
    let pitch: NotePitch

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(model.events.enumerated()), id: \.element.id) { index, event in
                TimelineCell(model: model, event: event, index: index, rowPitch: pitch)
                    .frame(width: cellWidth(for: event), height: StudioMetrics.rowHeight)
            }
        }
    }
}

private struct TimelineCell: View {
    @Bindable var model: ArrangerModel
    let event: NoteEvent
    let index: Int
    let rowPitch: NotePitch

    var body: some View {
        Rectangle()
            .fill(cellBackground)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(StudioPalette.grid)
                    .frame(height: 0.5)
            }
            .overlay(alignment: .trailing) {
                Rectangle()
                    .fill(index.isMultiple(of: 4) ? StudioPalette.gridStrong : StudioPalette.grid)
                    .frame(width: index.isMultiple(of: 4) ? 1 : 0.5)
            }
            .overlay {
                if event.pitch == rowPitch {
                    NoteBlock(model: model, event: event, index: index)
                        .padding(3)
                }
            }
    }

    private var cellBackground: Color {
        if model.playingEventID == event.id {
            return StudioPalette.accent.opacity(0.14)
        }
        return index.isMultiple(of: 2) ? .clear : Color.white.opacity(0.012)
    }
}

private struct NoteBlock: View {
    @Bindable var model: ArrangerModel
    let event: NoteEvent
    let index: Int
    @State private var isNativeDropTarget = false

    private var clip: RecordingClip? { model.clip(id: event.clipID) }
    private var isSelected: Bool { model.selectedEventID == event.id }
    private var isPlaying: Bool { model.playingEventID == event.id }
    private var isCustomDropTarget: Bool { model.targetedEventID == event.id }
    private var isDropTarget: Bool { isNativeDropTarget || isCustomDropTarget }

    var body: some View {
        Button {
            model.select(eventID: event.id)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 3) {
                    Text(event.pitch.rawValue)
                        .font(.caption2.weight(.heavy).monospaced())
                    Spacer(minLength: 0)
                    if event.correctionCents != 0 {
                        Text(compactCorrectionText)
                            .font(.caption2.weight(.bold).monospacedDigit())
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }

                Text(clip?.name.components(separatedBy: " ").first ?? "Drop sound")
                    .font(.caption2.weight(.medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }
            .padding(.horizontal, 7)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .foregroundStyle(clip == nil ? Color.white : Color.black.opacity(0.78))
            .background(noteBackground)
            .overlay(selectionBorder)
            .scaleEffect(isPlaying ? 1.045 : 1)
            .shadow(color: noteColor.opacity(isSelected ? 0.38 : 0.12), radius: isSelected ? 7 : 2, y: 2)
            .animation(.snappy(duration: 0.18), value: isPlaying)
            .animation(.snappy(duration: 0.18), value: isDropTarget)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Note \(index + 1), \(event.pitch.rawValue), \(clip?.name ?? "unassigned"), \(correctionText)")
        .accessibilityHint("Double tap to select, or drag onto another note to swap recordings")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("note-\(index + 1)")
        .draggable(ArrangerDragPayload(kind: .note, id: event.id)) {
            DragPreview(title: event.pitch.rawValue, subtitle: clip?.name ?? "Unassigned", color: noteColor)
        }
        .simultaneousGesture(customDragGesture)
        .dropDestination(for: ArrangerDragPayload.self) { payloads, _ in
            guard let payload = payloads.first else { return false }
            return model.handleDrop(payload, on: event.id)
        } isTargeted: { targeted in
            isNativeDropTarget = targeted
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
        event.correctionCents == 0 ? "0 cents" : "\(event.correctionCents > 0 ? "+" : "")\(event.correctionCents) cents"
    }

    private var compactCorrectionText: String {
        event.correctionCents == 0 ? "0¢" : "\(event.correctionCents > 0 ? "+" : "")\(event.correctionCents)¢"
    }

    private var noteColor: Color {
        clip.map { Color(hex: $0.colorHex) } ?? Color.white.opacity(0.32)
    }

    private var noteBackground: some View {
        LinearGradient(
            colors: clip == nil
                ? [Color.white.opacity(0.10), Color.white.opacity(0.055)]
                : [noteColor.opacity(isDropTarget ? 1 : 0.94), noteColor.opacity(0.68)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .clipShape(.rect(cornerRadius: 10))
    }

    private var selectionBorder: some View {
        RoundedRectangle(cornerRadius: 10)
            .strokeBorder(
                isDropTarget ? Color.white : (isSelected ? StudioPalette.accentSecondary : noteColor.opacity(0.72)),
                lineWidth: isDropTarget ? 3 : (isSelected ? 2 : 1)
            )
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

private struct SelectedNoteDock: View {
    @Bindable var model: ArrangerModel
    let openInspector: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(StudioPalette.gridStrong)
                .frame(height: 0.5)

            if let event = model.selectedEvent,
               let index = model.events.firstIndex(where: { $0.id == event.id }) {
                HStack(spacing: 10) {
                    SelectedPitchBadge(event: event, clip: model.clip(id: event.clipID))

                    VStack(alignment: .leading, spacing: 1) {
                        Text("Note \(index + 1) · \(beatsLabel(event.beats))")
                            .font(.caption)
                            .foregroundStyle(StudioPalette.mutedText)
                        Text(model.clip(id: event.clipID)?.name ?? "No recording")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                    }

                    Spacer(minLength: 0)

                    CompactActionButton(
                        title: "Hear",
                        systemImage: "speaker.wave.2.fill",
                        identifier: "hear-note",
                        action: model.auditionSelected
                    )

                    Button(action: openInspector) {
                        Label("Edit", systemImage: "slider.horizontal.3")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 13)
                            .frame(height: 38)
                            .background(StudioPalette.accent, in: Capsule())
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Edit selected note")
                    .accessibilityIdentifier("edit-note")

                    Menu {
                        Button("Move left", systemImage: "arrow.left", action: { model.moveSelected(by: -1) })
                            .disabled(index == 0)
                        Button("Move right", systemImage: "arrow.right", action: { model.moveSelected(by: 1) })
                            .disabled(index == model.events.count - 1)
                        Button("Duplicate", systemImage: "plus.square.on.square", action: model.duplicateSelected)
                        Button("Remove recording", systemImage: "waveform.slash", action: model.removeClipFromSelected)
                        Divider()
                        Button("Delete MIDI note", systemImage: "trash", role: .destructive, action: model.deleteSelected)
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.headline)
                            .frame(width: 36, height: 38)
                            .background(StudioPalette.raised, in: Circle())
                    }
                    .accessibilityLabel("More note actions")
                    .accessibilityIdentifier("note-actions")
                }
                .padding(.horizontal, StudioMetrics.screenPadding)
                .padding(.vertical, 10)
            } else {
                Label("Tap a note to edit it", systemImage: "hand.tap")
                    .font(.subheadline)
                    .foregroundStyle(StudioPalette.mutedText)
                    .frame(maxWidth: .infinity, minHeight: 62)
            }
        }
        .background(.ultraThinMaterial)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Selected note tools")
    }
}

private struct SelectedPitchBadge: View {
    let event: NoteEvent
    let clip: RecordingClip?

    var body: some View {
        VStack(spacing: 0) {
            Text(event.pitch.rawValue)
                .font(.subheadline.weight(.heavy).monospaced())
            Text(event.accent.rawValue.prefix(1).uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(Color.black.opacity(0.52))
        }
        .foregroundStyle(Color.black.opacity(0.82))
        .frame(width: 46, height: 46)
        .background((clip.map { Color(hex: $0.colorHex) } ?? .gray).gradient, in: .rect(cornerRadius: 13))
        .accessibilityHidden(true)
    }
}

private struct CompactActionButton: View {
    let title: String
    let systemImage: String
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.semibold))
                .frame(width: 36, height: 38)
                .background(StudioPalette.raised, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

private struct NoteInspectorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: ArrangerModel
    let eventID: String

    private var event: NoteEvent? {
        model.selectedEvent
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let event,
                   let index = model.events.firstIndex(where: { $0.id == event.id }) {
                    VStack(spacing: 18) {
                        InspectorSourceHeader(model: model, event: event, index: index)
                        NotePropertiesSection(model: model, event: event)
                        CorrectionSection(model: model, event: event)
                        InspectorActions(model: model, index: index, dismiss: dismiss)
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 30)
                } else {
                    ContentUnavailableView("Note unavailable", systemImage: "music.note")
                }
            }
            .background(StudioPalette.background)
            .navigationTitle("Edit note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: dismiss.callAsFunction)
                }
            }
        }
        .onAppear {
            model.select(eventID: eventID)
        }
        .accessibilityIdentifier("selected-note-inspector")
    }
}

private struct InspectorSourceHeader: View {
    @Bindable var model: ArrangerModel
    let event: NoteEvent
    let index: Int

    private var clip: RecordingClip? { model.clip(id: event.clipID) }

    var body: some View {
        HStack(spacing: 13) {
            SelectedPitchBadge(event: event, clip: clip)

            VStack(alignment: .leading, spacing: 3) {
                Text("NOTE \(index + 1)")
                    .font(.caption2.weight(.bold))
                    .tracking(0.9)
                    .foregroundStyle(StudioPalette.accentSecondary)
                Text(clip?.name ?? "No recording assigned")
                    .font(.title3.weight(.semibold))
                Text(clip?.detail ?? "Drag a sound onto this note")
                    .font(.caption)
                    .foregroundStyle(StudioPalette.mutedText)
            }

            Spacer(minLength: 0)

            Button(action: model.auditionSelected) {
                Image(systemName: "play.fill")
                    .font(.headline)
                    .frame(width: 44, height: 44)
                    .background(StudioPalette.raised, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Hear selected note")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 6)
        .accessibilityElement(children: .contain)
    }
}

private struct NotePropertiesSection: View {
    @Bindable var model: ArrangerModel
    let event: NoteEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Note properties")
                .font(.headline)

            HStack(spacing: 10) {
                PropertyMenu(title: "Pitch", value: event.pitch.rawValue, systemImage: "music.note") {
                    ForEach(NotePitch.allCases) { pitch in
                        Button(pitch.rawValue) { model.setPitch(pitch) }
                    }
                }
                .accessibilityIdentifier("pitch-picker")

                PropertyMenu(title: "Length", value: beatsLabel(event.beats), systemImage: "timer") {
                    ForEach([0.5, 1.0, 1.5, 2.0], id: \.self) { beats in
                        Button(beatsLabel(beats)) { model.setBeats(beats) }
                    }
                }
                .accessibilityIdentifier("length-picker")
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Accent")
                    .font(.caption)
                    .foregroundStyle(StudioPalette.mutedText)

                Picker("Accent", selection: Binding(get: { event.accent }, set: model.setAccent)) {
                    ForEach(NoteAccent.allCases) { accent in
                        Text(accent.rawValue.capitalized).tag(accent)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("accent-picker")
            }
        }
        .inspectorSectionStyle()
    }
}

private struct PropertyMenu<Content: View>: View {
    let title: String
    let value: String
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        Menu {
            content
        } label: {
            VStack(alignment: .leading, spacing: 7) {
                Label(title, systemImage: systemImage)
                    .font(.caption)
                    .foregroundStyle(StudioPalette.mutedText)
                HStack {
                    Text(value)
                        .font(.body.weight(.semibold))
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(StudioPalette.mutedText)
                }
            }
            .padding(11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(StudioPalette.raised, in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

private struct CorrectionSection: View {
    @Bindable var model: ArrangerModel
    let event: NoteEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pitch correction")
                        .font(.headline)
                    Text("Keep it subtle to preserve the recording")
                        .font(.caption)
                        .foregroundStyle(StudioPalette.mutedText)
                }

                Spacer()

                Text(correctionLabel)
                    .font(.body.weight(.bold).monospacedDigit())
                    .foregroundStyle(StudioPalette.accentSecondary)
            }

            Slider(
                value: Binding(
                    get: { Double(event.correctionCents) },
                    set: { model.setCorrection(Int($0.rounded())) }
                ),
                in: -50...50,
                step: 1
            )
            .tint(StudioPalette.accent)
            .accessibilityLabel("Pitch correction")
            .accessibilityValue(correctionLabel)
            .accessibilityIdentifier("pitch-correction")

            HStack {
                Text("−50¢")
                Spacer()
                Button("Reset") { model.setCorrection(0) }
                    .fontWeight(.semibold)
                Spacer()
                Text("+50¢")
            }
            .font(.caption)
            .foregroundStyle(StudioPalette.mutedText)
        }
        .inspectorSectionStyle()
    }

    private var correctionLabel: String {
        "\(event.correctionCents > 0 ? "+" : "")\(event.correctionCents)¢"
    }
}

private struct InspectorActions: View {
    @Bindable var model: ArrangerModel
    let index: Int
    let dismiss: DismissAction

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    model.moveSelected(by: -1)
                } label: {
                    Label("Move left", systemImage: "arrow.left")
                        .frame(maxWidth: .infinity)
                }
                .disabled(index == 0)
                .accessibilityIdentifier("move-left")

                Button {
                    model.moveSelected(by: 1)
                } label: {
                    Label("Move right", systemImage: "arrow.right")
                        .frame(maxWidth: .infinity)
                }
                .disabled(index == model.events.count - 1)
                .accessibilityIdentifier("move-right")
            }

            Button(action: model.duplicateSelected) {
                Label("Duplicate note", systemImage: "plus.square.on.square")
                    .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("duplicate-note")

            HStack(spacing: 10) {
                Button(role: .destructive, action: model.removeClipFromSelected) {
                    Label("Remove sound", systemImage: "waveform.slash")
                        .frame(maxWidth: .infinity)
                }

                Button(role: .destructive) {
                    model.deleteSelected()
                    dismiss()
                } label: {
                    Label("Delete note", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
    }
}

private struct DragPreview: View {
    let title: String
    let subtitle: String
    let color: Color

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "hand.draw.fill")
                .font(.headline)
                .foregroundStyle(color)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(StudioPalette.mutedText)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(.regularMaterial, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(color, lineWidth: 2))
        .shadow(color: .black.opacity(0.32), radius: 12, y: 6)
    }
}

private struct NoteFramePreferenceKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]

    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, latest in latest })
    }
}

private func cellWidth(for event: NoteEvent) -> CGFloat {
    max(StudioMetrics.minimumBeatWidth, event.beats * StudioMetrics.minimumBeatWidth)
}

private func beatsLabel(_ beats: Double) -> String {
    let formatted = beats.formatted(.number.precision(.fractionLength(0...1)))
    return "\(formatted) beat\(beats == 1 ? "" : "s")"
}

private struct InspectorSectionStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(StudioPalette.surface, in: .rect(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(StudioPalette.grid))
    }
}

private extension View {
    func inspectorSectionStyle() -> some View {
        modifier(InspectorSectionStyle())
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

#Preview("Studio arranger") {
    ArrangerRootView(model: ArrangerModel())
}
