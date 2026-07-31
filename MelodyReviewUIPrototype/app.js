// Three variants of the curated-melody listening review, switchable via ?variant=.
const evidenceRoot = "../Evidence/curated-melody-listening";
const melodyOrder = ["mary-lamb", "twinkle", "ode-to-joy"];
const modeOrder = ["choose-individual", "use-all", "recommend-best-fit"];
const modeLabels = {
  "choose-individual": "One source (control)",
  "use-all": "Full-corpus rotation",
  "recommend-best-fit": "Balanced best-fit five",
};
const filenames = melodyOrder.flatMap((melody) =>
  modeOrder.map((mode) => `${melody}__${mode}.json`),
);

const state = {
  ratings: {},
  policyVotes: {},
  notes: {},
  blindIndex: 0,
  revealed: {},
  studioMelody: melodyOrder[0],
  studioMode: modeOrder[0],
};

let candidates = [];

const app = document.querySelector("#app");

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function keyFor(candidate) {
  return `${candidate.melody.id}__${candidate.sourceMode}`;
}

function ratingFor(candidate) {
  return state.ratings[keyFor(candidate)] ?? { recognizable: null, fartOnly: null, artifacts: null };
}

function reviewedCount() {
  return Object.values(state.ratings).filter((rating) =>
    rating.recognizable !== null && rating.fartOnly !== null && rating.artifacts !== null,
  ).length;
}

function statePanel() {
  const voteCount = Object.values(state.policyVotes).filter(Boolean).length;
  return `
    <div class="state-panel">
      <div class="state-kpis">
        <div><b>${reviewedCount()}/9</b><span>fully reviewed</span></div>
        <div><b>${voteCount}/3</b><span>mode choices</span></div>
      </div>
      <details>
        <summary>Inspect full in-memory evaluation state</summary>
        <pre>${esc(JSON.stringify({ ratings: state.ratings, policyVotes: state.policyVotes, notes: state.notes }, null, 2))}</pre>
      </details>
    </div>`;
}

function warning() {
  return `
    <div class="provenance-warning">
      <span class="warning-icon">⚠</span>
      <div><strong>Diversity renderer evidence only</strong>The source strategies are intentionally different, but the note plans remain manually encoded without an authoritative score or licensing trail. Evaluate sound behavior here—not catalog provenance or release readiness.</div>
    </div>`;
}

function ratingButtons(candidate, field, labels = [["yes", "Yes"], ["mixed", "Mixed"], ["no", "No"]]) {
  const rating = ratingFor(candidate)[field];
  return `<div class="choice-row">${labels.map(([value, label]) =>
    `<button class="choice-button ${rating === value ? "selected" : ""}" data-rate="${field}" data-value="${value}" data-key="${keyFor(candidate)}">${label}</button>`,
  ).join("")}</div>`;
}

function compactRating(candidate, field) {
  const rating = ratingFor(candidate)[field];
  return `<div class="mini-toggle">${[["yes", "Y"], ["mixed", "~"], ["no", "N"]].map(([value, label]) =>
    `<button class="${rating === value ? "selected" : ""}" data-rate="${field}" data-value="${value}" data-key="${keyFor(candidate)}" title="${value}">${label}</button>`,
  ).join("")}</div>`;
}

function audioFor(candidate) {
  return `<audio controls preload="metadata" src="${evidenceRoot}/${candidate.outputFilename}"></audio>`;
}

function renderBlind() {
  const candidate = candidates[state.blindIndex];
  const revealed = state.revealed[keyFor(candidate)];
  const bars = Array.from({ length: 34 }, (_, index) =>
    `<i style="height:${18 + ((index * 29 + state.blindIndex * 17) % 53)}px"></i>`,
  ).join("");
  app.innerHTML = `
    <div class="blind-shell">
      <div class="prototype-flag">Throwaway prototype</div>
      <header class="blind-header">
        <div class="blind-brand"><span class="brand-dot"></span> Blind Listening Room</div>
        <div class="blind-progress">Candidate ${state.blindIndex + 1} of ${candidates.length}</div>
      </header>
      <div class="blind-layout">
        <section class="blind-stage">
          <div class="blind-number">LISTEN ${String(state.blindIndex + 1).padStart(2, "0")} · SOURCE MODE HIDDEN</div>
          <h1 class="blind-title">${revealed ? esc(candidate.melody.title) : "What do you hear?"}</h1>
          <p class="blind-subtitle">${revealed ? esc(modeLabels[candidate.sourceMode]) : "Judge the sound before revealing the expected tune or source policy."}</p>
          <div class="blind-player"><div class="sound-bars">${bars}</div>${audioFor(candidate)}</div>
          <div class="blind-question"><p>Recognizable as a melody?</p>${ratingButtons(candidate, "recognizable")}</div>
          <div class="blind-question"><p>Still unmistakably fart-only?</p>${ratingButtons(candidate, "fartOnly")}</div>
          <div class="blind-question"><p>Are repetition and pitch-shift artifacts acceptable?</p>${ratingButtons(candidate, "artifacts", [["yes", "Acceptable"], ["mixed", "Borderline"], ["no", "Reject"]])}</div>
          <div class="blind-nav">
            <button class="text-button" data-action="reveal">${revealed ? "Hide identity" : "Reveal identity"}</button>
            <button class="primary-button" data-action="next-blind">Next candidate →</button>
          </div>
        </section>
        <aside class="blind-aside">${warning()}${statePanel()}</aside>
      </div>
    </div>`;
}

function matrixCell(candidate) {
  const fit = candidate.fit;
  const voted = state.policyVotes[candidate.melody.id] === candidate.sourceMode;
  return `<td>
    <div class="cell-id">${esc(modeLabels[candidate.sourceMode])}</div>
    ${audioFor(candidate)}
    <div class="metric-strip">
      <div class="metric"><b>${fit.usedRecordingIDs.length}/${fit.selectedRecordingIDs.length}</b><span>sources used</span></div>
      <div class="metric"><b>${fit.meanAbsoluteSemitoneShift.toFixed(1)}</b><span>mean semitones</span></div>
      <div class="metric"><b>${fit.consecutiveSourceReuseCount}</b><span>consecutive reuse</span></div>
    </div>
    <div class="matrix-ratings">
      <label>Recognizable ${compactRating(candidate, "recognizable")}</label>
      <label>Fart-only ${compactRating(candidate, "fartOnly")}</label>
      <label>Artifacts okay ${compactRating(candidate, "artifacts")}</label>
    </div>
    <button class="mode-vote ${voted ? "selected" : ""}" data-vote="${candidate.sourceMode}" data-melody="${candidate.melody.id}">${voted ? "✓ Baseline selected" : "Select as baseline"}</button>
  </td>`;
}

function renderMatrix() {
  const rows = melodyOrder.map((melodyId) => {
    const row = modeOrder.map((mode) => candidates.find((candidate) => candidate.melody.id === melodyId && candidate.sourceMode === mode));
    return `<tr><td><div class="matrix-row-title">${esc(row[0].melody.title)}</div><p class="muted">${row[0].melody.bpm} BPM · ${row[0].melody.events.filter((event) => event.midiNote != null).length} notes</p></td>${row.map(matrixCell).join("")}</tr>`;
  }).join("");
  app.innerHTML = `
    <div class="matrix-shell">
      <div class="prototype-flag">Throwaway prototype</div>
      <header class="matrix-header">
        <div class="eyebrow">Pedos / comparative review board</div>
        <h1>Nine renders. One baseline policy.</h1>
        <p>Compare a one-source control, a full-corpus rotation, and a balanced five-source ensemble. Rate each render, then choose the strongest policy per row.</p>
      </header>
      <main class="matrix-content">
        <div class="matrix-toolbar">${warning()}${statePanel()}</div>
        <div class="matrix-table-wrap"><table class="matrix-table"><thead><tr><th>Melody</th>${modeOrder.map((mode) => `<th>${modeLabels[mode]}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      </main>
    </div>`;
}

function noteRibbon(candidate) {
  const notes = candidate.melody.events.filter((event) => event.midiNote != null);
  const min = Math.min(...notes.map((event) => event.midiNote));
  return notes.map((event) => `<i style="height:${24 + (event.midiNote - min) * 8}px; flex-grow:${event.beats}"></i>`).join("");
}

function renderStudio() {
  const melodyCandidates = modeOrder.map((mode) => candidates.find((candidate) => candidate.melody.id === state.studioMelody && candidate.sourceMode === mode));
  const candidate = melodyCandidates.find((item) => item.sourceMode === state.studioMode);
  const fit = candidate.fit;
  const rating = ratingFor(candidate);
  app.innerHTML = `
    <div class="studio-shell">
      <div class="prototype-flag">Throwaway prototype</div>
      <header class="studio-topbar"><div class="studio-logo">Pedos listening desk</div><div class="studio-step">Curated Melody Fit · approval draft</div></header>
      <div class="studio-grid">
        <nav class="studio-nav"><h2>Melodies</h2>${melodyCandidates.map((_, index) => {
          const melody = candidates.find((item) => item.melody.id === melodyOrder[index])?.melody;
          if (!melody) return "";
          return `<button class="melody-nav-button ${melody.id === state.studioMelody ? "selected" : ""}" data-studio-melody="${melody.id}"><b>${esc(melody.title)}</b><span>${state.policyVotes[melody.id] ? `Baseline: ${modeLabels[state.policyVotes[melody.id]]}` : "No baseline chosen"}</span></button>`;
        }).join("")}</nav>
        <main class="studio-main">
          <div class="eyebrow">Focused decision</div>
          <h1>${esc(candidate.melody.title)}</h1>
          <p class="lede">Hear the same melody through each source-selection policy. Compare the audible result with the technical cost before choosing the implementation baseline.</p>
          <div class="mode-tabs">${modeOrder.map((mode) => `<button class="mode-tab ${mode === state.studioMode ? "selected" : ""}" data-studio-mode="${mode}">${modeLabels[mode]}</button>`).join("")}</div>
          <section class="studio-listener">
            <div class="note-ribbon">${noteRibbon(candidate)}</div>
            ${audioFor(candidate)}
            <div class="studio-facts">
              <div class="fact"><b>${fit.selectedRecordingIDs.length}</b><span>eligible recordings</span></div>
              <div class="fact"><b>${fit.usedRecordingIDs.length}</b><span>actually used</span></div>
              <div class="fact"><b>${fit.meanAbsoluteSemitoneShift.toFixed(1)}</b><span>mean semitone shift</span></div>
              <div class="fact"><b>${fit.consecutiveSourceReuseCount}</b><span>consecutive reuse</span></div>
            </div>
            ${warning()}
          </section>
        </main>
        <aside class="studio-rail">
          <section class="decision-card">
            <h3>Your listening verdict</h3>
            <div class="decision-question"><p>Recognizable?</p>${ratingButtons(candidate, "recognizable")}</div>
            <div class="decision-question"><p>Unmistakably fart-only?</p>${ratingButtons(candidate, "fartOnly")}</div>
            <div class="decision-question"><p>Artifacts acceptable?</p>${ratingButtons(candidate, "artifacts", [["yes", "Yes"], ["mixed", "Maybe"], ["no", "No"]])}</div>
            <div class="decision-question"><p>Listening notes</p><textarea class="notes-input" data-notes="${keyFor(candidate)}" placeholder="What changed your judgment?">${esc(state.notes[keyFor(candidate)] ?? "")}</textarea></div>
            <button class="primary-button" data-vote="${candidate.sourceMode}" data-melody="${candidate.melody.id}">${state.policyVotes[candidate.melody.id] === candidate.sourceMode ? "✓ Selected baseline" : "Choose this baseline"}</button>
          </section>
          ${statePanel()}
        </aside>
      </div>
    </div>`;
}

const variants = {
  A: { name: "Blind listening room", render: renderBlind },
  B: { name: "Comparison matrix", render: renderMatrix },
  C: { name: "Decision studio", render: renderStudio },
};

function currentVariant() {
  const value = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return variants[value] ? value : "A";
}

function renderSwitcher() {
  if (!["localhost", "127.0.0.1"].includes(location.hostname) && location.protocol !== "file:") return;
  const key = currentVariant();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="prototype-switcher" aria-label="Prototype variants">
      <button data-variant-step="-1" aria-label="Previous variant">←</button>
      <div class="switcher-label">${key} — ${variants[key].name}</div>
      <button data-variant-step="1" aria-label="Next variant">→</button>
    </div>`);
}

function render() {
  document.querySelector(".prototype-switcher")?.remove();
  variants[currentVariant()].render();
  renderSwitcher();
  document.querySelectorAll("audio").forEach((audio) => audio.addEventListener("play", () => {
    document.querySelectorAll("audio").forEach((other) => { if (other !== audio) other.pause(); });
  }));
}

function switchVariant(step) {
  const keys = Object.keys(variants);
  const next = keys[(keys.indexOf(currentVariant()) + step + keys.length) % keys.length];
  const url = new URL(location.href);
  url.searchParams.set("variant", next);
  history.replaceState({}, "", url);
  render();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.variantStep) return switchVariant(Number(target.dataset.variantStep));
  if (target.dataset.rate) {
    state.ratings[target.dataset.key] ??= { recognizable: null, fartOnly: null, artifacts: null };
    state.ratings[target.dataset.key][target.dataset.rate] = target.dataset.value;
    return render();
  }
  if (target.dataset.action === "next-blind") {
    state.blindIndex = (state.blindIndex + 1) % candidates.length;
    return render();
  }
  if (target.dataset.action === "reveal") {
    const candidate = candidates[state.blindIndex];
    state.revealed[keyFor(candidate)] = !state.revealed[keyFor(candidate)];
    return render();
  }
  if (target.dataset.vote) {
    state.policyVotes[target.dataset.melody] = target.dataset.vote;
    return render();
  }
  if (target.dataset.studioMelody) {
    state.studioMelody = target.dataset.studioMelody;
    return render();
  }
  if (target.dataset.studioMode) {
    state.studioMode = target.dataset.studioMode;
    return render();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-notes]")) state.notes[event.target.dataset.notes] = event.target.value;
});

document.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (event.target.matches("input, textarea, [contenteditable]")) return;
  event.preventDefault();
  switchVariant(event.key === "ArrowRight" ? 1 : -1);
});

Promise.all(filenames.map(async (filename) => {
  const response = await fetch(`${evidenceRoot}/${filename}`);
  if (!response.ok) throw new Error(`Could not load ${filename}`);
  return response.json();
})).then((loaded) => {
  candidates = loaded;
  render();
}).catch((error) => {
  app.innerHTML = `<div class="error"><h1>Prototype could not load</h1><p>${esc(error.message)}</p><p>Start it from the repository with <code>Tools/run-melody-review-ui</code>.</p></div>`;
});
