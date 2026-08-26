// Three variants of a MIDI-guided Pedos Song Maker, switchable via ?variant=A|B|C.
// Question: is auto-fill plus optional note-level clip swapping a better product model
// than asking users to build a song (or trusting an invisible renderer) from scratch?

const sampleRoot = "../../docs/research/prototypes/pedos-app-v1/test-data/fart-samples";

const clips = [
  {
    id: "round",
    short: "Round",
    name: "Round 013",
    source: "Recording 013",
    tone: "round · soft attack",
    natural: "C4",
    maxLength: "1.8s",
    color: "#f6a93b",
    url: `${sampleRoot}/013__deleted-user-1391979__bad-chili-fart-wav__94989.mp3`,
  },
  {
    id: "bright",
    short: "Bright",
    name: "Bright 019",
    source: "Recording 019",
    tone: "bright · quick",
    natural: "D4",
    maxLength: "0.8s",
    color: "#65b7a4",
    url: `${sampleRoot}/019__fartcto__fart-short__789839.mp3`,
  },
  {
    id: "smooth",
    short: "Smooth",
    name: "Smooth 016",
    source: "Recording 016",
    tone: "smooth · even body",
    natural: "E4",
    maxLength: "1.4s",
    color: "#7d8cf0",
    url: `${sampleRoot}/016__tv-ling__perfect-fart-mp3__523467.mp3`,
  },
  {
    id: "pop",
    short: "Pop",
    name: "Pop 018",
    source: "Recording 018",
    tone: "dry · accented",
    natural: "F4",
    maxLength: "0.6s",
    color: "#eb6f64",
    url: `${sampleRoot}/018__sadiquecat__short-fart__787755.mp3`,
  },
  {
    id: "long",
    short: "Long",
    name: "Long 021",
    source: "Recording 021",
    tone: "buzzy · long tail",
    natural: "G4",
    maxLength: "2.3s",
    color: "#bc78d1",
    url: `${sampleRoot}/021__designerschoice__fartreal-samsung-galaxy-smartphone-cu-short-buzzing-fart-nichola__807507.mp3`,
  },
];

// Public-domain composition; UI-prototype transcription, not a catalog or provenance artifact.
const score = [
  ["E4", 64, 1, "strong", "smooth", 12],
  ["E4", 64, 1, "light", "smooth", -8],
  ["F4", 65, 1, "medium", "pop", 18],
  ["G4", 67, 1, "strong", "long", -26],
  ["G4", 67, 1, "medium", "long", 9],
  ["F4", 65, 1, "light", "pop", -15],
  ["E4", 64, 1, "medium", "smooth", 20],
  ["D4", 62, 1, "medium", "bright", -11],
  ["C4", 60, 1, "strong", "round", 16],
  ["C4", 60, 1, "light", "round", -6],
  ["D4", 62, 1, "medium", "bright", 14],
  ["E4", 64, 1, "strong", "smooth", -19],
  ["E4", 64, 1.5, "medium", "smooth", 7],
  ["D4", 62, 0.5, "light", "bright", -17],
  ["D4", 62, 2, "strong", "bright", 4],
].map(([pitch, midi, beats, accent, suggestedClip, correction], index) => ({
  id: `note-${index + 1}`,
  index,
  pitch,
  midi,
  beats,
  accent,
  bar: Math.floor(index / 4) + 1,
  suggestedClip,
  suggestedCorrection: correction,
}));

const state = {
  assignments: Object.fromEntries(score.map((note) => [note.id, {
    clipId: note.suggestedClip,
    correction: note.suggestedCorrection,
  }])),
  selectedClipId: "smooth",
  focusedNoteId: "note-1",
  playingIndex: null,
  playing: false,
  tempo: 112,
  inspectorOpen: true,
};

const app = document.querySelector("#app");
let sequenceTimer = null;
let activeAudios = [];

const variants = {
  A: { name: "Guided auto-fill", description: "Recommended: song first, smart fill, optional swaps" },
  B: { name: "Clip lanes", description: "A compact, visual mini-DAW" },
  C: { name: "Note focus", description: "One decision at a time, no grid literacy needed" },
};

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function clipById(id) {
  return clips.find((clip) => clip.id === id);
}

function noteById(id) {
  return score.find((note) => note.id === id);
}

function assignmentFor(note) {
  return state.assignments[note.id] ?? null;
}

function currentVariant() {
  const key = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return variants[key] ? key : "A";
}

function assignedCount() {
  return Object.values(state.assignments).filter(Boolean).length;
}

function clipUsage() {
  return clips.map((clip) => ({
    id: clip.id,
    notes: score.filter((note) => assignmentFor(note)?.clipId === clip.id).length,
  }));
}

function correctionLabel(value) {
  if (value === 0) return "0¢";
  return `${value > 0 ? "+" : ""}${value}¢`;
}

function durationLabel(beats) {
  return `${beats} beat${beats === 1 ? "" : "s"}`;
}

function contextStrip() {
  return `
    <section class="prototype-question">
      <span class="prototype-kicker">Throwaway question</span>
      <p>Does a supplied MIDI melody + smart clip placement make songs easier to recognize, while keeping note-level control optional?</p>
    </section>`;
}

function songHeader({ compact = false } = {}) {
  return `
    <section class="song-header ${compact ? "compact" : ""}">
      <div class="song-art" aria-hidden="true"><span>♫</span></div>
      <div class="song-copy">
        <span class="overline">Built-in test melody</span>
        <h1>Ode to Joy <span>opening</span></h1>
        <p>Beethoven · public-domain composition · ${score.length} MIDI notes · ${state.tempo} BPM</p>
      </div>
      <button class="icon-button" data-action="restart" aria-label="Restart playback">↺</button>
    </section>`;
}

function playButton(label = "Play song") {
  return `<button class="play-button ${state.playing ? "playing" : ""}" data-action="toggle-play"><span>${state.playing ? "■" : "▶"}</span>${state.playing ? "Stop" : label}</button>`;
}

function smartFillButton(label = "Smart fill") {
  return `<button class="smart-fill" data-action="smart-fill"><span>✦</span>${label}</button>`;
}

function noteBlock(note, { lane = false, focus = false } = {}) {
  const assignment = assignmentFor(note);
  const clip = assignment ? clipById(assignment.clipId) : null;
  const selected = state.focusedNoteId === note.id;
  const playing = state.playingIndex === note.index;
  const style = clip ? `--note-color:${clip.color}; --note-width:${Math.max(54, note.beats * 68)}px` : `--note-width:${Math.max(54, note.beats * 68)}px`;
  return `
    <button
      class="note-block ${clip ? "assigned" : "empty"} ${selected ? "selected" : ""} ${playing ? "is-playing" : ""} ${lane ? "lane-note" : ""} ${focus ? "focus-note" : ""}"
      style="${style}"
      data-note-id="${note.id}"
      data-drop-note="${note.id}"
      aria-label="${note.pitch}, ${clip ? `${clip.name}, ${correctionLabel(assignment.correction)}` : "unassigned"}"
    >
      <span class="note-pitch">${note.pitch}</span>
      ${clip ? `<span class="note-source">${clip.short}</span><span class="note-cents">${correctionLabel(assignment.correction)}</span>` : `<span class="note-source">Drop clip</span>`}
      ${playing ? `<span class="playhead-dot"></span>` : ""}
    </button>`;
}

function keyboardRows(innerBuilder) {
  const rows = ["G4", "F4", "E4", "D4", "C4"];
  return `
    <div class="piano-roll" aria-label="Ode to Joy piano roll">
      ${rows.map((pitch) => `
        <div class="pitch-row ${pitch.includes("#") ? "black" : ""}">
          <span class="piano-key">${pitch}</span>
          <div class="pitch-track">${innerBuilder(pitch)}</div>
        </div>`).join("")}
      <div class="beat-ruler"><span></span>${Array.from({ length: 16 }, (_, i) => `<i>${i % 4 === 0 ? i / 4 + 1 : ""}</i>`).join("")}</div>
    </div>`;
}

function linearPianoRoll() {
  return keyboardRows((pitch) => {
    const cells = score.map((note) => {
      const assignment = assignmentFor(note);
      const clip = assignment ? clipById(assignment.clipId) : null;
      return `<div class="roll-cell ${note.pitch === pitch ? "has-note" : ""}" style="--cell-grow:${note.beats}">${note.pitch === pitch ? noteBlock(note) : ""}</div>`;
    }).join("");
    return `<div class="roll-timeline">${cells}</div>`;
  });
}

function clipCard(clip, { horizontal = false } = {}) {
  const selected = state.selectedClipId === clip.id;
  const usage = clipUsage().find((item) => item.id === clip.id)?.notes ?? 0;
  return `
    <button
      class="clip-card ${selected ? "selected" : ""} ${horizontal ? "horizontal" : ""}"
      style="--clip-color:${clip.color}"
      draggable="true"
      data-clip-id="${clip.id}"
      aria-pressed="${selected}"
    >
      <span class="clip-grip">⠿</span>
      <span class="clip-wave" aria-hidden="true">${Array.from({ length: 13 }, (_, i) => `<i style="height:${8 + ((i * 11 + clip.id.length * 7) % 24)}px"></i>`).join("")}</span>
      <span class="clip-copy"><b>${clip.name}</b><small>${clip.natural} · ${clip.tone}</small></span>
      <span class="clip-usage">${usage}</span>
    </button>`;
}

function clipTray({ horizontal = true, title = "Your recordings" } = {}) {
  return `
    <section class="clip-tray ${horizontal ? "horizontal" : "vertical"}">
      <div class="section-heading">
        <div><span class="overline">Tap, then tap a note · or drag</span><h2>${title}</h2></div>
        <span class="tray-count">${clips.length} ready</span>
      </div>
      <div class="clip-list">${clips.map((clip) => clipCard(clip, { horizontal })).join("")}</div>
    </section>`;
}

function focusedInspector({ minimal = false } = {}) {
  const note = noteById(state.focusedNoteId) ?? score[0];
  const assignment = assignmentFor(note);
  const clip = assignment ? clipById(assignment.clipId) : null;
  if (minimal) {
    return `
      <section class="mini-inspector">
        <div><span>Selected note</span><b>${note.pitch} · ${durationLabel(note.beats)}</b></div>
        <div><span>Source</span><b>${clip?.name ?? "Unassigned"}</b></div>
        <div><span>Correction</span><b>${assignment ? correctionLabel(assignment.correction) : "—"}</b></div>
        <button class="audition-button" data-action="audition-note" ${clip ? "" : "disabled"}>▶ Note</button>
      </section>`;
  }
  return `
    <section class="note-inspector">
      <div class="inspector-heading">
        <div><span class="overline">Note ${note.index + 1} of ${score.length}</span><h2>${note.pitch} · ${durationLabel(note.beats)}</h2></div>
        <button class="audition-button" data-action="audition-note" ${clip ? "" : "disabled"}>▶ Audition</button>
      </div>
      <div class="inspector-grid">
        <div class="inspector-source" style="--clip-color:${clip?.color ?? "#dedbd4"}">
          <span class="source-dot"></span>
          <div><small>Source clip</small><b>${clip?.name ?? "No clip assigned"}</b><span>${clip?.tone ?? "Select a recording below"}</span></div>
        </div>
        <label class="correction-control">
          <span><small>Small pitch correction</small><b>${assignment ? correctionLabel(assignment.correction) : "—"}</b></span>
          <input type="range" min="-50" max="50" step="1" value="${assignment?.correction ?? 0}" data-correction-for="${note.id}" ${assignment ? "" : "disabled"} />
        </label>
        <div class="note-properties"><span><small>Accent</small><b>${note.accent}</b></span><span><small>MIDI note</small><b>${note.midi}</b></span></div>
      </div>
      <div class="inspector-actions">
        <span>${state.selectedClipId ? `${clipById(state.selectedClipId).name} selected — tap another note to replace it.` : "Select a clip, then tap a note."}</span>
        <button class="text-action danger" data-action="clear-note">Clear note</button>
      </div>
    </section>`;
}

function bottomTabs(active = "Create") {
  return `
    <nav class="app-tabs" aria-label="Pedos app sections">
      ${[["▰", "Shelf"], ["✦", "Create"], ["♫", "Melodies"]].map(([icon, label]) => `
        <button class="${active === label ? "active" : ""}"><span>${icon}</span>${label}</button>`).join("")}
    </nav>`;
}

function stateDisclosure() {
  const payload = {
    variant: currentVariant(),
    song: "Ode to Joy — opening",
    tempo: state.tempo,
    selectedClipId: state.selectedClipId,
    focusedNoteId: state.focusedNoteId,
    assignments: state.assignments,
  };
  return `
    <details class="state-disclosure">
      <summary><span>Prototype state</span><b>${assignedCount()}/${score.length} assigned · ${clips.filter((clip) => clipUsage().some((item) => item.id === clip.id && item.notes > 0)).length} sources</b></summary>
      <pre>${esc(JSON.stringify(payload, null, 2))}</pre>
    </details>`;
}

function renderVariantA() {
  app.innerHTML = `
    <div class="variant-a app-canvas">
      <div class="desktop-note">Recommended product direction · auto-fill first, edit only if you want</div>
      <main class="phone-shell">
        <header class="app-bar"><b>Pedos</b><span>Song Maker</span><button aria-label="More options">•••</button></header>
        ${contextStrip()}
        ${songHeader()}
        <section class="completion-card">
          <div class="completion-copy"><span class="completion-ring">${assignedCount()}<small>/${score.length}</small></span><div><b>${assignedCount() === score.length ? "Your arrangement is ready" : "A few notes need clips"}</b><p>Smart Fill matched pitch, length, accent, and tone. Swap only the notes you dislike.</p></div></div>
          <div class="primary-actions">${playButton()}${smartFillButton("Refill")}</div>
        </section>
        <section class="roll-section">
          <div class="section-heading"><div><span class="overline">Drag a clip onto any note</span><h2>Piano roll</h2></div><span class="legend"><i></i> small pitch correction</span></div>
          <div class="roll-scroll">${linearPianoRoll()}</div>
        </section>
        ${focusedInspector()}
        ${clipTray()}
        ${stateDisclosure()}
        <section class="prototype-boundary"><b>Prototype boundary</b><span>Interaction proof only. Audio quality, MIDI ingestion, catalog rights, and source clearance are separate gates.</span></section>
        ${bottomTabs("Create")}
      </main>
    </div>`;
}

function laneGrid() {
  return `
    <div class="lane-grid">
      <div class="lane-grid-header"><span>Source lane</span><div>${score.map((note, i) => `<i style="--cell-grow:${note.beats}">${i % 4 === 0 ? `Bar ${Math.floor(i / 4) + 1}` : ""}</i>`).join("")}</div></div>
      ${clips.map((clip) => `
        <div class="source-lane" style="--clip-color:${clip.color}" data-lane-clip="${clip.id}">
          <button class="lane-label" data-clip-id="${clip.id}" draggable="true"><span class="source-dot"></span><b>${clip.short}</b><small>${clip.natural}</small></button>
          <div class="lane-timeline">${score.map((note) => {
            const assignment = assignmentFor(note);
            const occupied = assignment?.clipId === clip.id;
            return `<div class="lane-cell ${occupied ? "occupied" : ""}" style="--cell-grow:${note.beats}" data-drop-note="${note.id}" title="${note.pitch}">${occupied ? noteBlock(note, { lane: true }) : `<span>${note.pitch}</span>`}</div>`;
          }).join("")}</div>
        </div>`).join("")}
    </div>`;
}

function renderVariantB() {
  app.innerHTML = `
    <div class="variant-b workbench-shell">
      <header class="workbench-topbar"><div><b>Pedos</b><span>/ Song Maker workbench</span></div><span class="prototype-badge">UI prototype</span></header>
      ${contextStrip()}
      <section class="workbench-heading">
        ${songHeader({ compact: true })}
        <div class="workbench-actions">${smartFillButton("Auto-map clips")}${playButton("Preview all")}</div>
      </section>
      <main class="workbench-grid">
        <section class="lane-panel">
          <div class="section-heading"><div><span class="overline">Each row is one source recording</span><h2>Clip lanes</h2></div><span class="tray-count">${assignedCount()}/${score.length} mapped</span></div>
          <p class="lane-help">Drag a source label onto a note column, or tap a source then any cell. This exposes reuse and gaps like a tiny DAW.</p>
          <div class="lane-scroll">${laneGrid()}</div>
          ${focusedInspector({ minimal: true })}
        </section>
        <aside class="workbench-rail">
          ${clipTray({ horizontal: false, title: "Clip rack" })}
          <section class="rail-card"><span class="overline">Arrangement health</span><h3>${assignedCount() === score.length ? "Ready to preview" : "Incomplete"}</h3><ul><li><b>${clips.length}</b> source tones</li><li><b>±50¢</b> correction limit</li><li><b>0</b> synthesized notes</li></ul></section>
          ${stateDisclosure()}
        </aside>
      </main>
      ${bottomTabs("Create")}
    </div>`;
}

function noteStepper() {
  const focused = noteById(state.focusedNoteId) ?? score[0];
  return `
    <div class="note-stepper">
      ${score.map((note) => {
        const assignment = assignmentFor(note);
        const clip = assignment ? clipById(assignment.clipId) : null;
        return `<button class="step-dot ${note.id === focused.id ? "active" : ""} ${clip ? "filled" : ""}" style="--dot-color:${clip?.color ?? "#ddd"}" data-note-id="${note.id}"><span>${note.pitch}</span><i></i></button>`;
      }).join("")}
    </div>`;
}

function renderVariantC() {
  const note = noteById(state.focusedNoteId) ?? score[0];
  const assignment = assignmentFor(note);
  const assignedClip = assignment ? clipById(assignment.clipId) : null;
  app.innerHTML = `
    <div class="variant-c app-canvas">
      <div class="desktop-note">Alternative for non-musicians · review one suggested note at a time</div>
      <main class="phone-shell focus-shell">
        <header class="focus-header"><button class="back-button" aria-label="Back">‹</button><div><span>Song Maker</span><b>Review the mapping</b></div><span class="focus-count">${note.index + 1}/${score.length}</span></header>
        ${contextStrip()}
        <section class="focus-song-strip">${playButton("Hear all")}<div><b>Ode to Joy</b><span>Public-domain composition · opening</span></div>${smartFillButton("Reset")}</section>
        ${noteStepper()}
        <section class="focus-stage">
          <span class="overline">MIDI asks for</span>
          <div class="focus-pitch"><span>${note.pitch.slice(0, -1)}</span><sup>${note.pitch.slice(-1)}</sup></div>
          <div class="focus-metadata"><span><small>Length</small><b>${durationLabel(note.beats)}</b></span><span><small>Accent</small><b>${note.accent}</b></span><span><small>MIDI</small><b>${note.midi}</b></span></div>
          <div class="focus-connector" aria-hidden="true"><i></i><span>matched to</span><i></i></div>
          <button class="chosen-clip" style="--clip-color:${assignedClip?.color ?? "#d8d4ce"}" data-action="audition-note" ${assignedClip ? "" : "disabled"}>
            <span class="chosen-icon">${assignedClip ? "▶" : "+"}</span>
            <span><small>Source recording</small><b>${assignedClip?.name ?? "Choose a clip"}</b><em>${assignedClip?.tone ?? "Nothing assigned"}</em></span>
            <strong>${assignment ? correctionLabel(assignment.correction) : "—"}</strong>
          </button>
          ${assignment ? `<label class="focus-slider"><span>Pitch correction <b>${correctionLabel(assignment.correction)}</b></span><input type="range" min="-50" max="50" step="1" value="${assignment.correction}" data-correction-for="${note.id}" /></label>` : ""}
        </section>
        <section class="focus-picker">
          <div class="section-heading"><div><span class="overline">Tap a different sound to replace it</span><h2>Suggested recordings</h2></div></div>
          <div class="focus-clip-list">${clips.map((clip) => {
            const active = assignedClip?.id === clip.id;
            return `<button class="focus-clip ${active ? "active" : ""}" style="--clip-color:${clip.color}" draggable="true" data-clip-id="${clip.id}"><span class="source-dot"></span><span><b>${clip.name}</b><small>${clip.natural} · ${clip.maxLength}</small></span><em>${active ? "Used" : "Use"}</em></button>`;
          }).join("")}</div>
        </section>
        <div class="focus-nav"><button data-action="previous-note" ${note.index === 0 ? "disabled" : ""}>← Previous</button><button class="next-button" data-action="next-note">${note.index === score.length - 1 ? "Done" : "Next note →"}</button></div>
        ${stateDisclosure()}
        <section class="prototype-boundary"><b>Prototype boundary</b><span>The melody is supplied; the user is only reviewing source choices. This does not prove renderer quality or a release-ready catalog.</span></section>
        ${bottomTabs("Create")}
      </main>
    </div>`;
}

function renderSwitcher() {
  const key = currentVariant();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="prototype-switcher" aria-label="Prototype variants">
      <button data-variant-step="-1" aria-label="Previous variant">←</button>
      <div><b>${key} — ${variants[key].name}</b><span>${variants[key].description}</span></div>
      <button data-variant-step="1" aria-label="Next variant">→</button>
    </div>`);
}

function render() {
  document.querySelector(".prototype-switcher")?.remove();
  const key = currentVariant();
  if (key === "A") renderVariantA();
  if (key === "B") renderVariantB();
  if (key === "C") renderVariantC();
  renderSwitcher();
}

function switchVariant(step) {
  const keys = Object.keys(variants);
  const next = keys[(keys.indexOf(currentVariant()) + step + keys.length) % keys.length];
  const url = new URL(location.href);
  url.searchParams.set("variant", next);
  history.replaceState({}, "", url);
  render();
}

function assignClip(noteId, clipId) {
  const note = noteById(noteId);
  const clip = clipById(clipId);
  if (!note || !clip) return;
  state.assignments[noteId] = {
    clipId,
    correction: clip.id === note.suggestedClip ? note.suggestedCorrection : 0,
  };
  state.focusedNoteId = noteId;
  state.selectedClipId = clipId;
  render();
}

function smartFill() {
  score.forEach((note) => {
    state.assignments[note.id] = { clipId: note.suggestedClip, correction: note.suggestedCorrection };
  });
  render();
}

function stopPlayback({ renderAfter = true } = {}) {
  if (sequenceTimer) clearTimeout(sequenceTimer);
  sequenceTimer = null;
  activeAudios.forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
  });
  activeAudios = [];
  state.playing = false;
  state.playingIndex = null;
  if (renderAfter) render();
}

function playNote(note, assignment = assignmentFor(note)) {
  if (!assignment) return;
  const clip = clipById(assignment.clipId);
  const audio = new Audio(clip.url);
  audio.preload = "auto";
  audio.playbackRate = Math.pow(2, assignment.correction / 1200);
  audio.volume = note.accent === "strong" ? 0.95 : note.accent === "light" ? 0.72 : 0.84;
  activeAudios.push(audio);
  audio.play().catch(() => {});
  const beatMs = 60000 / state.tempo;
  setTimeout(() => {
    audio.pause();
    activeAudios = activeAudios.filter((item) => item !== audio);
  }, Math.max(180, beatMs * note.beats * 0.9));
}

function playSequence(index = 0) {
  if (index >= score.length) {
    stopPlayback();
    return;
  }
  state.playing = true;
  state.playingIndex = index;
  state.focusedNoteId = score[index].id;
  playNote(score[index]);
  render();
  const beatMs = 60000 / state.tempo;
  sequenceTimer = setTimeout(() => playSequence(index + 1), beatMs * score[index].beats);
}

function focusRelative(delta) {
  const note = noteById(state.focusedNoteId) ?? score[0];
  const nextIndex = Math.max(0, Math.min(score.length - 1, note.index + delta));
  state.focusedNoteId = score[nextIndex].id;
  render();
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.variantStep) return switchVariant(Number(button.dataset.variantStep));
  if (button.dataset.clipId) {
    state.selectedClipId = button.dataset.clipId;
    if (currentVariant() === "C") assignClip(state.focusedNoteId, button.dataset.clipId);
    else render();
    return;
  }
  if (button.dataset.noteId) {
    state.focusedNoteId = button.dataset.noteId;
    if (state.selectedClipId) assignClip(button.dataset.noteId, state.selectedClipId);
    else render();
    return;
  }
  const action = button.dataset.action;
  if (action === "smart-fill") return smartFill();
  if (action === "toggle-play") {
    if (state.playing) stopPlayback();
    else playSequence();
    return;
  }
  if (action === "restart") {
    stopPlayback({ renderAfter: false });
    playSequence();
    return;
  }
  if (action === "audition-note") {
    const note = noteById(state.focusedNoteId) ?? score[0];
    playNote(note);
    return;
  }
  if (action === "clear-note") {
    delete state.assignments[state.focusedNoteId];
    render();
    return;
  }
  if (action === "previous-note") return focusRelative(-1);
  if (action === "next-note") return focusRelative(1);
});

document.addEventListener("input", (event) => {
  const noteId = event.target.dataset.correctionFor;
  if (!noteId || !state.assignments[noteId]) return;
  state.assignments[noteId].correction = Number(event.target.value);
  const label = event.target.closest("label")?.querySelector("b");
  if (label) label.textContent = correctionLabel(state.assignments[noteId].correction);
  document.querySelectorAll(`[data-note-id="${noteId}"] .note-cents`).forEach((node) => {
    node.textContent = correctionLabel(state.assignments[noteId].correction);
  });
});

document.addEventListener("dragstart", (event) => {
  const source = event.target.closest("[data-clip-id]");
  if (!source) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/plain", source.dataset.clipId);
  document.body.classList.add("is-dragging");
});

document.addEventListener("dragend", () => document.body.classList.remove("is-dragging"));

document.addEventListener("dragover", (event) => {
  const target = event.target.closest("[data-drop-note]");
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  target.classList.add("drag-over");
});

document.addEventListener("dragleave", (event) => event.target.closest("[data-drop-note]")?.classList.remove("drag-over"));

document.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-drop-note]");
  if (!target) return;
  event.preventDefault();
  document.body.classList.remove("is-dragging");
  assignClip(target.dataset.dropNote, event.dataTransfer.getData("text/plain"));
});

document.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (event.target.matches("input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
  switchVariant(event.key === "ArrowRight" ? 1 : -1);
});

render();
