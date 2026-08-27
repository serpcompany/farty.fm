import AVFoundation
import CoreTransferable
import CoreGraphics
import Foundation
import Observation
import UniformTypeIdentifiers

extension UTType {
    static let pedosArrangerPayload = UTType(exportedAs: "com.serpcompany.pedos.arranger-payload")
}

struct ArrangerDragPayload: Codable, Hashable, Sendable, Transferable {
    enum Kind: String, Codable, Sendable {
        case clip
        case note
    }

    let kind: Kind
    let id: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .pedosArrangerPayload)
    }
}

enum NotePitch: String, CaseIterable, Codable, Identifiable, Sendable {
    case c4 = "C4"
    case d4 = "D4"
    case e4 = "E4"
    case f4 = "F4"
    case g4 = "G4"
    case a4 = "A4"

    var id: String { rawValue }

    var midi: Int {
        switch self {
        case .c4: 60
        case .d4: 62
        case .e4: 64
        case .f4: 65
        case .g4: 67
        case .a4: 69
        }
    }
}

enum NoteAccent: String, CaseIterable, Codable, Identifiable, Sendable {
    case light
    case medium
    case strong

    var id: String { rawValue }

    var volume: Float {
        switch self {
        case .light: 0.70
        case .medium: 0.84
        case .strong: 0.98
        }
    }
}

struct RecordingClip: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let detail: String
    let naturalPitch: NotePitch
    let filename: String
    let colorHex: UInt
}

struct NoteEvent: Identifiable, Hashable, Sendable {
    let id: String
    var pitch: NotePitch
    var beats: Double
    var accent: NoteAccent
    var clipID: String?
    var correctionCents: Int
}

struct SongSeed: Sendable {
    let pitch: NotePitch
    let beats: Double
    let accent: NoteAccent
}

struct SongTemplate: Identifiable, Sendable {
    let id: String
    let title: String
    let composer: String
    let tempo: Double
    let difficulty: String
    let seeds: [SongSeed]
}

@MainActor
@Observable
final class ArrangerModel {
    struct Snapshot {
        let songID: String
        let events: [NoteEvent]
    }

    static let clips: [RecordingClip] = [
        RecordingClip(
            id: "round",
            name: "Round 013",
            detail: "round · soft attack",
            naturalPitch: .c4,
            filename: "013__deleted-user-1391979__bad-chili-fart-wav__94989.mp3",
            colorHex: 0xF6A93B
        ),
        RecordingClip(
            id: "bright",
            name: "Bright 019",
            detail: "bright · quick",
            naturalPitch: .d4,
            filename: "019__fartcto__fart-short__789839.mp3",
            colorHex: 0x65B7A4
        ),
        RecordingClip(
            id: "smooth",
            name: "Smooth 016",
            detail: "smooth · even body",
            naturalPitch: .e4,
            filename: "016__tv-ling__perfect-fart-mp3__523467.mp3",
            colorHex: 0x7D8CF0
        ),
        RecordingClip(
            id: "pop",
            name: "Pop 018",
            detail: "dry · accented",
            naturalPitch: .f4,
            filename: "018__sadiquecat__short-fart__787755.mp3",
            colorHex: 0xEB6F64
        ),
        RecordingClip(
            id: "long",
            name: "Long 021",
            detail: "buzzy · long tail",
            naturalPitch: .g4,
            filename: "021__designerschoice__fartreal-samsung-galaxy-smartphone-cu-short-buzzing-fart-nichola__807507.mp3",
            colorHex: 0xBC78D1
        ),
    ]

    static let songs: [SongTemplate] = [
        SongTemplate(
            id: "ode",
            title: "Ode to Joy",
            composer: "Beethoven",
            tempo: 112,
            difficulty: "Easy · 5 pitches",
            seeds: [
                .init(pitch: .e4, beats: 1, accent: .strong), .init(pitch: .e4, beats: 1, accent: .light),
                .init(pitch: .f4, beats: 1, accent: .medium), .init(pitch: .g4, beats: 1, accent: .strong),
                .init(pitch: .g4, beats: 1, accent: .medium), .init(pitch: .f4, beats: 1, accent: .light),
                .init(pitch: .e4, beats: 1, accent: .medium), .init(pitch: .d4, beats: 1, accent: .medium),
                .init(pitch: .c4, beats: 1, accent: .strong), .init(pitch: .c4, beats: 1, accent: .light),
                .init(pitch: .d4, beats: 1, accent: .medium), .init(pitch: .e4, beats: 1, accent: .strong),
                .init(pitch: .e4, beats: 1.5, accent: .medium), .init(pitch: .d4, beats: 0.5, accent: .light),
                .init(pitch: .d4, beats: 2, accent: .strong),
            ]
        ),
        SongTemplate(
            id: "mary",
            title: "Mary Had a Little Lamb",
            composer: "Traditional",
            tempo: 118,
            difficulty: "Easy · 4 pitches",
            seeds: [
                .init(pitch: .e4, beats: 1, accent: .strong), .init(pitch: .d4, beats: 1, accent: .medium),
                .init(pitch: .c4, beats: 1, accent: .medium), .init(pitch: .d4, beats: 1, accent: .light),
                .init(pitch: .e4, beats: 1, accent: .strong), .init(pitch: .e4, beats: 1, accent: .medium),
                .init(pitch: .e4, beats: 2, accent: .medium), .init(pitch: .d4, beats: 1, accent: .strong),
                .init(pitch: .d4, beats: 1, accent: .medium), .init(pitch: .d4, beats: 2, accent: .medium),
                .init(pitch: .e4, beats: 1, accent: .strong), .init(pitch: .g4, beats: 1, accent: .medium),
                .init(pitch: .g4, beats: 2, accent: .medium),
            ]
        ),
        SongTemplate(
            id: "twinkle",
            title: "Twinkle Twinkle Little Star",
            composer: "Traditional",
            tempo: 104,
            difficulty: "Easy · 6 pitches",
            seeds: [
                .init(pitch: .c4, beats: 1, accent: .strong), .init(pitch: .c4, beats: 1, accent: .light),
                .init(pitch: .g4, beats: 1, accent: .medium), .init(pitch: .g4, beats: 1, accent: .light),
                .init(pitch: .a4, beats: 1, accent: .strong), .init(pitch: .a4, beats: 1, accent: .light),
                .init(pitch: .g4, beats: 2, accent: .medium), .init(pitch: .f4, beats: 1, accent: .strong),
                .init(pitch: .f4, beats: 1, accent: .light), .init(pitch: .e4, beats: 1, accent: .medium),
                .init(pitch: .e4, beats: 1, accent: .light), .init(pitch: .d4, beats: 1, accent: .strong),
                .init(pitch: .d4, beats: 1, accent: .light), .init(pitch: .c4, beats: 2, accent: .medium),
            ]
        ),
        SongTemplate(
            id: "jingle",
            title: "Jingle Bells",
            composer: "James Lord Pierpont",
            tempo: 126,
            difficulty: "Medium · 5 pitches",
            seeds: [
                .init(pitch: .e4, beats: 1, accent: .strong), .init(pitch: .e4, beats: 1, accent: .light),
                .init(pitch: .e4, beats: 2, accent: .medium), .init(pitch: .e4, beats: 1, accent: .strong),
                .init(pitch: .e4, beats: 1, accent: .light), .init(pitch: .e4, beats: 2, accent: .medium),
                .init(pitch: .e4, beats: 1, accent: .strong), .init(pitch: .g4, beats: 1, accent: .medium),
                .init(pitch: .c4, beats: 1.5, accent: .medium), .init(pitch: .d4, beats: 0.5, accent: .light),
                .init(pitch: .e4, beats: 2, accent: .strong),
            ]
        ),
    ]

    private static let correctionPattern = [12, -8, 18, -26, 9, -15, 20, -11, 16, -6, 14, -19, 7, -17, 4]

    var selectedSongID = "ode"
    var events: [NoteEvent] = []
    var selectedEventID: String?
    var targetedEventID: String?
    var isPlaying = false
    var playingEventID: String?
    var statusMessage = "Auto Mapped · drag a recording onto any note"
    var activeDragPayload: ArrangerDragPayload?
    var activeDragLocation: CGPoint?

    private var history: [Snapshot] = []
    private var future: [Snapshot] = []
    @ObservationIgnored private var audioPlayer: AVAudioPlayer?
    @ObservationIgnored private var playbackTask: Task<Void, Never>?
    @ObservationIgnored private var customCounter = 0
    @ObservationIgnored private var noteFrames: [String: CGRect] = [:]

    init() {
        loadSong(id: "ode", rememberCurrent: false)
    }

    var selectedSong: SongTemplate {
        Self.songs.first(where: { $0.id == selectedSongID }) ?? Self.songs[0]
    }

    var selectedEvent: NoteEvent? {
        guard let selectedEventID else { return nil }
        return events.first(where: { $0.id == selectedEventID })
    }

    var assignedCount: Int { events.filter { $0.clipID != nil }.count }
    var canUndo: Bool { !history.isEmpty }
    var canRedo: Bool { !future.isEmpty }

    func clip(id: String?) -> RecordingClip? {
        guard let id else { return nil }
        return Self.clips.first(where: { $0.id == id })
    }

    func selectSong(id: String) {
        guard id != selectedSongID else { return }
        loadSong(id: id, rememberCurrent: true)
    }

    func autoMap() {
        remember()
        for index in events.indices {
            events[index].clipID = suggestedClipID(for: events[index].pitch)
            events[index].correctionCents = Self.correctionPattern[index % Self.correctionPattern.count]
        }
        statusMessage = "Auto Map restored \(assignedCount)/\(events.count) notes"
    }

    func handleDrop(_ payload: ArrangerDragPayload, on targetID: String) -> Bool {
        guard let targetIndex = events.firstIndex(where: { $0.id == targetID }) else { return false }
        remember()
        switch payload.kind {
        case .clip:
            guard clip(id: payload.id) != nil else { return false }
            events[targetIndex].clipID = payload.id
            events[targetIndex].correctionCents = 0
            statusMessage = "Dropped \(clip(id: payload.id)?.name ?? "Recording") on \(events[targetIndex].pitch.rawValue)"
        case .note:
            guard let sourceIndex = events.firstIndex(where: { $0.id == payload.id }), sourceIndex != targetIndex else {
                return false
            }
            let sourceClipID = events[sourceIndex].clipID
            let sourceCorrection = events[sourceIndex].correctionCents
            events[sourceIndex].clipID = events[targetIndex].clipID
            events[sourceIndex].correctionCents = events[targetIndex].correctionCents
            events[targetIndex].clipID = sourceClipID
            events[targetIndex].correctionCents = sourceCorrection
            statusMessage = "Swapped note \(sourceIndex + 1) with note \(targetIndex + 1)"
        }
        selectedEventID = targetID
        return true
    }

    func updateNoteFrames(_ frames: [String: CGRect]) {
        noteFrames = frames
    }

    func updateCustomDrag(_ payload: ArrangerDragPayload, location: CGPoint) {
        activeDragPayload = payload
        activeDragLocation = location
        targetedEventID = noteFrames.first(where: { $0.value.insetBy(dx: -14, dy: -14).contains(location) })?.key
    }

    func finishCustomDrag() {
        let payload = activeDragPayload
        let target = targetedEventID
        activeDragPayload = nil
        activeDragLocation = nil
        targetedEventID = nil
        if let payload, let target {
            _ = handleDrop(payload, on: target)
        }
    }

    func cancelCustomDrag() {
        activeDragPayload = nil
        activeDragLocation = nil
        targetedEventID = nil
    }

    var activeDragTitle: String {
        guard let payload = activeDragPayload else { return "" }
        switch payload.kind {
        case .clip:
            return clip(id: payload.id)?.name ?? "Recording"
        case .note:
            guard let event = events.first(where: { $0.id == payload.id }) else { return "Note" }
            return "\(event.pitch.rawValue) · \(clip(id: event.clipID)?.name ?? "Unassigned")"
        }
    }

    var activeDragColorHex: UInt {
        guard let payload = activeDragPayload else { return 0xFF6B35 }
        switch payload.kind {
        case .clip:
            return clip(id: payload.id)?.colorHex ?? 0xFF6B35
        case .note:
            let event = events.first(where: { $0.id == payload.id })
            return clip(id: event?.clipID)?.colorHex ?? 0xFF6B35
        }
    }

    func select(eventID: String) {
        selectedEventID = eventID
    }

    func addNote() {
        remember()
        customCounter += 1
        let pitch = selectedEvent?.pitch ?? .c4
        let event = NoteEvent(
            id: "\(selectedSongID)-custom-\(customCounter)",
            pitch: pitch,
            beats: 1,
            accent: .medium,
            clipID: suggestedClipID(for: pitch),
            correctionCents: 0
        )
        events.append(event)
        selectedEventID = event.id
        statusMessage = "Added a new \(pitch.rawValue) note"
    }

    func duplicateSelected() {
        guard let selectedEventID, let index = events.firstIndex(where: { $0.id == selectedEventID }) else { return }
        remember()
        customCounter += 1
        var copy = events[index]
        copy = NoteEvent(
            id: "\(selectedSongID)-custom-\(customCounter)",
            pitch: copy.pitch,
            beats: copy.beats,
            accent: copy.accent,
            clipID: copy.clipID,
            correctionCents: copy.correctionCents
        )
        events.insert(copy, at: index + 1)
        self.selectedEventID = copy.id
        statusMessage = "Duplicated note \(index + 1)"
    }

    func deleteSelected() {
        guard let selectedEventID, let index = events.firstIndex(where: { $0.id == selectedEventID }) else { return }
        remember()
        events.remove(at: index)
        self.selectedEventID = events.isEmpty ? nil : events[min(index, events.count - 1)].id
        statusMessage = "Deleted one note"
    }

    func removeClipFromSelected() {
        guard let index = selectedIndex else { return }
        remember()
        events[index].clipID = nil
        events[index].correctionCents = 0
        statusMessage = "Removed the recording; MIDI note remains"
    }

    func moveSelected(by delta: Int) {
        guard let selectedEventID, let sourceIndex = events.firstIndex(where: { $0.id == selectedEventID }) else { return }
        let targetIndex = sourceIndex + delta
        guard events.indices.contains(targetIndex) else { return }
        remember()
        events.swapAt(sourceIndex, targetIndex)
        statusMessage = "Moved note to position \(targetIndex + 1)"
    }

    func setPitch(_ pitch: NotePitch) {
        guard let index = selectedIndex else { return }
        remember()
        events[index].pitch = pitch
        statusMessage = "Changed selected note to \(pitch.rawValue)"
    }

    func setBeats(_ beats: Double) {
        guard let index = selectedIndex else { return }
        remember()
        events[index].beats = beats
        statusMessage = "Changed note length"
    }

    func setAccent(_ accent: NoteAccent) {
        guard let index = selectedIndex else { return }
        remember()
        events[index].accent = accent
        statusMessage = "Changed note accent"
    }

    func setCorrection(_ cents: Int) {
        guard let index = selectedIndex else { return }
        events[index].correctionCents = cents
    }

    func undo() {
        guard let snapshot = history.popLast() else { return }
        future.append(currentSnapshot)
        restore(snapshot)
        statusMessage = "Undid the last edit"
    }

    func redo() {
        guard let snapshot = future.popLast() else { return }
        history.append(currentSnapshot)
        restore(snapshot)
        statusMessage = "Redid the edit"
    }

    func auditionSelected() {
        guard let selectedEvent else { return }
        stopPlayback()
        playAudio(for: selectedEvent)
        statusMessage = "Playing note \((events.firstIndex(of: selectedEvent) ?? 0) + 1)"
    }

    func audition(clipID: String) {
        guard let clip = clip(id: clipID) else { return }
        stopPlayback()
        let event = NoteEvent(
            id: "audition",
            pitch: clip.naturalPitch,
            beats: 1,
            accent: .medium,
            clipID: clipID,
            correctionCents: 0
        )
        playAudio(for: event)
        statusMessage = "Playing \(clip.name) · press and drag it onto a note"
    }

    func togglePreview() {
        if isPlaying {
            stopPlayback()
            return
        }
        let arrangement = events
        let tempo = selectedSong.tempo
        isPlaying = true
        playbackTask = Task { [weak self] in
            guard let self else { return }
            for event in arrangement {
                guard !Task.isCancelled else { break }
                self.playingEventID = event.id
                self.playAudio(for: event)
                let seconds = event.beats * 60 / tempo
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            }
            if !Task.isCancelled {
                self.isPlaying = false
                self.playingEventID = nil
                self.statusMessage = "Preview finished"
            }
        }
    }

    func stopPlayback() {
        playbackTask?.cancel()
        playbackTask = nil
        audioPlayer?.stop()
        audioPlayer = nil
        isPlaying = false
        playingEventID = nil
    }

    private var selectedIndex: Int? {
        guard let selectedEventID else { return nil }
        return events.firstIndex(where: { $0.id == selectedEventID })
    }

    private var currentSnapshot: Snapshot {
        Snapshot(songID: selectedSongID, events: events)
    }

    private func remember() {
        history.append(currentSnapshot)
        if history.count > 30 { history.removeFirst() }
        future.removeAll()
    }

    private func restore(_ snapshot: Snapshot) {
        selectedSongID = snapshot.songID
        events = snapshot.events
        selectedEventID = events.first?.id
    }

    private func loadSong(id: String, rememberCurrent: Bool) {
        guard let song = Self.songs.first(where: { $0.id == id }) else { return }
        if rememberCurrent, !events.isEmpty { remember() }
        stopPlayback()
        selectedSongID = id
        events = song.seeds.enumerated().map { index, seed in
            NoteEvent(
                id: "\(id)-note-\(index + 1)",
                pitch: seed.pitch,
                beats: seed.beats,
                accent: seed.accent,
                clipID: suggestedClipID(for: seed.pitch),
                correctionCents: Self.correctionPattern[index % Self.correctionPattern.count]
            )
        }
        selectedEventID = events.first?.id
        statusMessage = "Loaded and Auto Mapped \(song.title)"
    }

    private func suggestedClipID(for pitch: NotePitch) -> String {
        switch pitch {
        case .c4: "round"
        case .d4: "bright"
        case .e4: "smooth"
        case .f4: "pop"
        case .g4, .a4: "long"
        }
    }

    private func playAudio(for event: NoteEvent) {
        guard let clip = clip(id: event.clipID),
              let url = Bundle.main.url(forResource: clip.filename, withExtension: nil) else {
            statusMessage = "That bundled recording could not be played"
            return
        }
        do {
            audioPlayer?.stop()
            let player = try AVAudioPlayer(contentsOf: url)
            player.enableRate = true
            player.rate = Float(pow(2, Double(event.correctionCents) / 1200))
            player.volume = event.accent.volume
            player.prepareToPlay()
            player.play()
            audioPlayer = player
        } catch {
            statusMessage = "Playback failed: \(error.localizedDescription)"
        }
    }
}
