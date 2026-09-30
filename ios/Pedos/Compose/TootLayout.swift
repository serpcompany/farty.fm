import SwiftUI

/// What Song Creator and a Toot's screen share: Play, the note view, and the Recordings used.
///
/// For checking the sound: tap a Recording to hear it alone and see which notes it plays; tap a
/// note to hear just that note as rendered, with what it is and how far its Recording moved.
struct TootLayout<Details: View>: View {
    let model: any AppModel
    let song: Song
    let arrangement: Arrangement
    /// The made or saved Toot; its notes play as `.note(tootID, index:)`.
    let tootID: UUID
    /// What Play plays: the whole Toot.
    let item: PlaybackItem
    /// The Toot's audio is gone: Play and the notes can't play, and the Recordings still can.
    var isAudioMissing = false
    /// More lines under "N of your Recordings, one per note".
    @ViewBuilder let details: Details

    @State private var focus: Focus?

    /// A Recording's notes (by the pitch it plays), or one note, stand out.
    private enum Focus: Equatable {
        case pitch(Int)
        case note(Int)
    }

    var body: some View {
        let isPlaying = model.nowPlaying == item
        List {
            Section {
                HStack(spacing: 16) {
                    Button {
                        focus = nil
                        model.togglePlayback(of: item)
                    } label: {
                        Image(systemName: isAudioMissing ? "exclamationmark.circle.fill" : isPlaying ? "stop.circle.fill" : "play.circle.fill")
                            .font(.system(size: 56))
                            .symbolRenderingMode(.hierarchical)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(isAudioMissing ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
                    .disabled(isAudioMissing)
                    .accessibilityLabel(isAudioMissing ? "Audio missing" : isPlaying ? "Stop" : "Play")
                    .accessibilityIdentifier("song-creator-play")
                    VStack(alignment: .leading, spacing: 2) {
                        Text(isAudioMissing ? "Audio missing" : isPlaying ? "Playing" : "Ready")
                            .font(.headline)
                        Text("\(song.pitches.count) of your Recordings, one per note")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        details
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    NoteView(
                        song: song,
                        arrangement: arrangement,
                        recordingName: { recording(playing: $0)?.name ?? "Recording deleted" },
                        startedAt: isPlaying ? model.playbackStartedAt : nil,
                        highlightedPitch: highlightedPitch,
                        selectedNote: selectedNote,
                        playingNote: playingNote,
                        onTapNote: tapNote
                    )
                    .frame(height: 180)
                    if let selectedNote {
                        let note = song.notes[selectedNote]
                        Text(arrangement.caption(of: note, in: song, recording: recording(playing: note)))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 16)
                            .accessibilityIdentifier("note-caption")
                    }
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 0, trailing: 0))
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            Section("Recordings used") {
                ForEach(song.pitches.indices, id: \.self) { index in
                    let pitch = song.pitches[index]
                    let color = NoteView.color(forPitchAt: index)
                    let note = Pitch.name(Double(arrangement.soundingPitch(pitch)))
                    if let recording = arrangement.recordingForPitch[pitch].flatMap({ model.recording($0) }) {
                        RecordingRow(
                            recording: recording,
                            isPlaying: model.nowPlaying == .recording(recording.id),
                            color: color,
                            showsWaveform: true,
                            playsNote: note,
                            isHighlighted: highlightedPitch == pitch
                        ) {
                            tapRecording(recording, playing: pitch)
                        }
                    } else {
                        DeletedRecordingRow(color: color, playsNote: note, isHighlighted: highlightedPitch == pitch)
                    }
                }
            }
        }
        .contentMargins(.top, 8, for: .scrollContent)
    }

    private var selectedNote: Int? {
        if case .note(let index) = focus { index } else { nil }
    }

    private var highlightedPitch: Int? {
        switch focus {
        case .pitch(let pitch): pitch
        case .note(let index): song.notes[index].pitch
        case nil: nil
        }
    }

    private var playingNote: Int? {
        if case .note(let id, let index) = model.nowPlaying, id == tootID { index } else { nil }
    }

    private func recording(playing note: Song.Note) -> Recording? {
        arrangement.recording(playing: note).flatMap { model.recording($0) }
    }

    /// Plays the Recording alone and highlights its notes; tapping it again stops it.
    private func tapRecording(_ recording: Recording, playing pitch: Int) {
        let stopping = model.nowPlaying == .recording(recording.id)
        focus = stopping ? nil : .pitch(pitch)
        model.togglePlayback(of: .recording(recording.id))
    }

    /// Selects the note and plays just it, as rendered. It stops whatever was playing.
    private func tapNote(_ index: Int) {
        guard !isAudioMissing else { return }
        focus = .note(index)
        model.togglePlayback(of: .note(tootID, index: index))
    }
}
