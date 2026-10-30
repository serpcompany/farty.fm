# Recordings are plain files; Recording Analysis runs after saving

Capture uses `AVAudioRecorder` to write mono 44.1 kHz AAC to a temporary draft. The user previews it and either saves or discards. Saving moves the draft into `Application Support/Recordings`, and the Recordings list is rebuilt by listing that folder. This approach passed the recorder proof (see tag `archive/prototype/recorder-local-persistence`).

Recording Analysis runs once, after the save has finished, and its result is stored next to the Recording. Capture, saving and playback never depend on it. The original file stays authoritative, so a better analyzer can re-analyze every Recording later. The analysis records each Recording's single clean gesture, its pitch contour, its Recording Pitch, and the shortest note it can hold on pitch. Individual Recordings never have a key; key belongs to the melody.

Update 2026-10-30 (ADR 0016, #276): the analysis no longer cuts a Recording to a single clean gesture. It records two extents: the gesture, the whole fart with only the silence around it trimmed and every burst kept, which Songs play; and the first burst, which its pitch contour, Recording Pitch, shortest note and settle time are read from. The Recordings tab plays the whole file.
