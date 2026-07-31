// PROTOTYPE — throwaway interaction exploration for issue "Approve the end-to-end MVP interaction design".
const variantMeta = {
  A: { name: "Capture Dock", component: VariantA },
  B: { name: "Library Canvas", component: VariantB },
  C: { name: "Guided Path", component: VariantC },
};

const state = {
  recordings: [
    { id: 1, name: "Low rumble", duration: "1.8s", tone: "Low", selected: true },
    { id: 2, name: "Tiny squeak", duration: "0.7s", tone: "High", selected: true },
    { id: 3, name: "Dry pop", duration: "1.1s", tone: "Mid", selected: false },
    { id: 4, name: "Long wobble", duration: "2.4s", tone: "Low", selected: false },
  ],
  melodies: [
    { id: 1, name: "Twinkle, Twinkle", kind: "Song Creator", duration: "0:18" },
    { id: 2, name: "Kitchen Sneak", kind: "AI Song Creator", duration: "0:24" },
  ],
  view: "home",
  creator: "curated",
  recording: false,
  playing: null,
  toast: "",
  wizardStep: 1,
};

const app = document.querySelector("#app");

function icon(name) {
  const icons = {
    record: "●",
    recordings: "≋",
    create: "✦",
    melody: "♫",
    play: "▶",
    pause: "Ⅱ",
    trash: "⌫",
    back: "‹",
    more: "•••",
    check: "✓",
    spark: "✦",
  };
  return `<span aria-hidden="true">${icons[name]}</span>`;
}

function render() {
  const variant = getVariant();
  document.body.dataset.variant = variant;
  app.innerHTML = variantMeta[variant].component();
  bindActions();
  renderSwitcher(variant);
}

function getVariant() {
  const candidate = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return variantMeta[candidate] ? candidate : "A";
}

function setVariant(next) {
  const url = new URL(location.href);
  url.searchParams.set("variant", next);
  history.replaceState({}, "", url);
  state.view = "home";
  state.wizardStep = 1;
  state.toast = "";
  render();
}

function cycleVariant(direction) {
  const keys = Object.keys(variantMeta);
  const current = keys.indexOf(getVariant());
  setVariant(keys[(current + direction + keys.length) % keys.length]);
}

function selectedCount() {
  return state.recordings.filter((item) => item.selected).length;
}

function recordingRows(compact = false) {
  return state.recordings
    .map(
      (item) => `
        <article class="recording-row ${item.selected ? "selected" : ""}">
          <button class="play-mini" data-action="play-recording" data-id="${item.id}" aria-label="Play ${item.name}">
            ${state.playing === `recording-${item.id}` ? icon("pause") : icon("play")}
          </button>
          <button class="recording-copy" data-action="toggle-source" data-id="${item.id}">
            <strong>${item.name}</strong>
            <span>${item.duration}${compact ? "" : ` · ${item.tone} tone`}</span>
          </button>
          <button class="source-check" data-action="toggle-source" data-id="${item.id}" aria-label="${item.selected ? "Remove" : "Add"} ${item.name}">
            ${item.selected ? icon("check") : "+"}
          </button>
          <button class="icon-button danger" data-action="delete-recording" data-id="${item.id}" aria-label="Delete ${item.name}">
            ${icon("trash")}
          </button>
        </article>
      `,
    )
    .join("");
}

function melodyRows() {
  if (!state.melodies.length) {
    return `<div class="empty-state"><span class="empty-icon">♫</span><strong>No Created Melodies yet</strong><p>Create one from your Recordings.</p></div>`;
  }
  return state.melodies
    .map(
      (item) => `
        <article class="melody-row">
          <button class="album-button" data-action="play-melody" data-id="${item.id}" aria-label="Play ${item.name}">
            ${state.playing === `melody-${item.id}` ? icon("pause") : icon("play")}
          </button>
          <div>
            <strong>${item.name}</strong>
            <span>${item.kind} · ${item.duration}</span>
          </div>
          <button class="icon-button danger" data-action="delete-melody" data-id="${item.id}" aria-label="Delete ${item.name}">
            ${icon("trash")}
          </button>
        </article>
      `,
    )
    .join("");
}

function sourceSummary() {
  const names = state.recordings.filter((item) => item.selected).map((item) => item.name);
  return names.length ? names.join(", ") : "No Recordings selected";
}

function creatorControls(prefix = "") {
  return `
    <div class="mode-toggle" role="tablist" aria-label="Creation area">
      <button class="${state.creator === "curated" ? "active" : ""}" data-action="creator" data-value="curated">Song Creator</button>
      <button class="${state.creator === "ai" ? "active" : ""}" data-action="creator" data-value="ai">AI Song Creator</button>
    </div>
    <div class="creator-explainer">
      <span class="eyebrow">${state.creator === "curated" ? "Known melody" : "New melody plan"}</span>
      <h2>${state.creator === "curated" ? "Choose a tune you already know" : "Let Pedos compose the tune"}</h2>
      <p>${state.creator === "curated" ? "Your selected Recordings render a recognizable, rights-safe melody." : "A new melody plan is composed and rendered only from your selected Recordings."}</p>
    </div>
    ${
      state.creator === "curated"
        ? `<div class="choice-stack">
            <label class="choice selected"><input type="radio" checked name="${prefix}tune" /> <span><strong>Twinkle, Twinkle</strong><small>Simple · about 18 seconds</small></span><b>›</b></label>
            <label class="choice"><input type="radio" name="${prefix}tune" /> <span><strong>Ode to Joy</strong><small>Bright · about 22 seconds</small></span><b>›</b></label>
            <label class="choice"><input type="radio" name="${prefix}tune" /> <span><strong>When the Saints</strong><small>Bouncy · about 20 seconds</small></span><b>›</b></label>
          </div>`
        : `<div class="prompt-card">
            <span class="spark-orb">${icon("spark")}</span>
            <div><strong>Surprise me</strong><p>Pedos will use the pitch and duration qualities of your selected Recordings.</p></div>
          </div>`
    }
    <button class="primary-action" data-action="create-melody" ${selectedCount() ? "" : "disabled"}>
      ${icon("spark")} Create with ${selectedCount()} Recording${selectedCount() === 1 ? "" : "s"}
    </button>
  `;
}

function phoneShell(content, className = "") {
  return `
    <section class="prototype-stage">
      <div class="phone ${className}">
        <div class="status-bar"><span>9:41</span><span>● ● ● ᯤ</span></div>
        ${content}
        ${state.toast ? `<div class="toast">${state.toast}</div>` : ""}
      </div>
      <aside class="variant-note">
        <span>Variant ${getVariant()}</span>
        <h1>${variantMeta[getVariant()].name}</h1>
        <p>${variantDescription(getVariant())}</p>
      </aside>
    </section>
  `;
}

function variantDescription(variant) {
  return {
    A: "Capture is always one tap away. A stable dock makes the three product areas feel like peers.",
    B: "Recordings are the home surface. Selection is persistent, and creation opens as a task layered over the library.",
    C: "The app leads with one recommended next action and turns creation into a short, explicit sequence.",
  }[variant];
}

function VariantA() {
  let content;
  if (state.view === "home") {
    content = `
      <header class="a-header"><div><span class="eyebrow">Good evening</span><h1>Your sound shelf</h1></div><button class="avatar">D</button></header>
      <section class="a-hero">
        <div><span class="eyebrow">Ready when you are</span><h2>Catch the moment.</h2><p>One fart per Recording. Preview before it joins your shelf.</p></div>
        <button class="record-orb ${state.recording ? "active" : ""}" data-action="record">${state.recording ? "■" : "●"}<small>${state.recording ? "Stop" : "Record"}</small></button>
      </section>
      <section class="section-block"><div class="section-title"><h2>Recent Recordings</h2><button data-action="view" data-value="recordings">See all</button></div>${recordingRows(true).split("</article>").slice(0, 2).join("</article>")}</section>
      <button class="wide-feature" data-action="view" data-value="create"><span class="feature-icon">♫</span><span><small>Make something</small><strong>Turn Recordings into a melody</strong></span><b>›</b></button>
    `;
  } else if (state.view === "recordings") {
    content = `
      <header class="screen-header"><div><span class="eyebrow">Your audio material</span><h1>Recordings</h1></div><button class="record-inline" data-action="record">● New</button></header>
      <p class="helper-copy">Tap the circle to include a Recording the next time you create.</p>
      <section class="list-stack">${recordingRows()}</section>
    `;
  } else if (state.view === "create") {
    content = `
      <header class="screen-header"><div><span class="eyebrow">Use only what you recorded</span><h1>Create</h1></div><button class="selection-pill" data-action="view" data-value="recordings">${selectedCount()} selected</button></header>
      <section class="creator-pane">${creatorControls("a-")}</section>
    `;
  } else {
    content = `<header class="screen-header"><div><span class="eyebrow">Saved locally</span><h1>Created Melodies</h1></div></header><section class="list-stack">${melodyRows()}</section>`;
  }
  return phoneShell(`
    <div class="screen a-screen">${content}</div>
    <nav class="a-dock" aria-label="Main navigation">
      ${dockButton("home", "recordings", "Shelf")}
      ${dockButton("create", "create", "Create")}
      ${dockButton("melodies", "melody", "Melodies")}
    </nav>
  `, "variant-a");
}

function dockButton(view, symbol, label) {
  return `<button class="${state.view === view ? "active" : ""}" data-action="view" data-value="${view}">${icon(symbol)}<span>${label}</span></button>`;
}

function VariantB() {
  if (state.view === "create") {
    return phoneShell(`
      <div class="screen b-screen dimmed">
        ${bLibraryHeader()}
        <section class="b-recordings">${recordingRows()}</section>
      </div>
      <section class="create-sheet">
        <div class="sheet-handle"></div>
        <button class="sheet-close" data-action="view" data-value="home">×</button>
        <span class="eyebrow">Create from your active tray</span>
        ${creatorControls("b-")}
      </section>
    `, "variant-b");
  }
  if (state.view === "melodies") {
    return phoneShell(`
      <div class="screen b-screen">
        <header class="b-topbar"><button data-action="view" data-value="home">${icon("back")} Recordings</button><span>Pedos</span><button class="avatar">D</button></header>
        <section class="b-title"><span class="eyebrow">Your finished pieces</span><h1>Created Melodies</h1></section>
        <section class="b-recordings">${melodyRows()}</section>
      </div>
      ${bActionTray(false)}
    `, "variant-b");
  }
  return phoneShell(`
    <div class="screen b-screen">
      ${bLibraryHeader()}
      <section class="b-recordings">${recordingRows()}</section>
    </div>
    ${bActionTray(true)}
  `, "variant-b");
}

function bLibraryHeader() {
  return `
    <header class="b-topbar"><span class="wordmark">Pedos</span><button data-action="view" data-value="melodies">♫ ${state.melodies.length}</button><button class="avatar">D</button></header>
    <section class="b-title"><div><span class="eyebrow">Local library</span><h1>Recordings</h1></div><button class="record-square ${state.recording ? "active" : ""}" data-action="record">${state.recording ? "■ Stop" : "● Record"}</button></section>
    <p class="helper-copy">Build an active tray as you listen. Your choices stay visible below.</p>
  `;
}

function bActionTray(canCreate) {
  return `
    <aside class="action-tray">
      <div><span class="tray-count">${selectedCount()}</span><span><small>Active tray</small><strong>${sourceSummary()}</strong></span></div>
      <button data-action="view" data-value="${canCreate ? "create" : "home"}">${canCreate ? "Create" : "Back to library"} <b>›</b></button>
    </aside>
  `;
}

function VariantC() {
  let content;
  if (state.view === "home") {
    content = `
      <header class="c-header"><span class="wordmark">Pedos</span><button class="avatar">D</button></header>
      <section class="c-focus">
        <span class="step-kicker">Your next move</span>
        <div class="focus-graphic"><span>◖</span><span>◗</span><b>●</b></div>
        <h1>Make a fresh Recording</h1>
        <p>Capture one fart, check it, and save it locally.</p>
        <button class="primary-action coral" data-action="record">${state.recording ? "■ Stop & review" : "● Start recording"}</button>
      </section>
      <section class="c-progress">
        <div><span class="progress-number">${state.recordings.length}</span><span><strong>Recordings ready</strong><small>Enough material to create</small></span></div>
        <button data-action="view" data-value="create">Create a melody <b>›</b></button>
      </section>
      <section class="section-block"><div class="section-title"><h2>Last Created Melody</h2><button data-action="view" data-value="melodies">All</button></div>${melodyRows().split("</article>")[0]}</article></section>
    `;
  } else if (state.view === "recordings") {
    content = `
      <header class="screen-header"><div><span class="eyebrow">Step 1</span><h1>Choose Recordings</h1></div><span class="step-badge">${selectedCount()} chosen</span></header>
      <p class="helper-copy">Pick individually, or let Pedos recommend the best Melody Fit.</p>
      <button class="recommend-button" data-action="recommend">${icon("spark")} Recommend best fit</button>
      <section class="list-stack">${recordingRows()}</section>
      <button class="primary-action sticky-next" data-action="wizard-next">Continue with ${selectedCount()}</button>
    `;
  } else if (state.view === "create") {
    if (state.wizardStep === 1) {
      state.view = "recordings";
      return VariantC();
    }
    content = `
      <header class="screen-header"><button class="back-button" data-action="wizard-back" aria-label="Back to Recording selection">${icon("back")}</button><div><span class="eyebrow">Step 2 of 2</span><h1>Choose how to create</h1></div></header>
      <section class="creator-pane">${creatorControls("c-")}</section>
    `;
  } else {
    content = `
      <header class="screen-header"><div><span class="eyebrow">Listen anytime</span><h1>Created Melodies</h1></div></header>
      <section class="now-playing">
        <span class="album-art">♫</span><div><small>Ready to play</small><strong>${state.melodies[0]?.name ?? "Nothing here yet"}</strong></div>
      </section>
      <section class="list-stack">${melodyRows()}</section>
    `;
  }
  return phoneShell(`
    <div class="screen c-screen">${content}</div>
    <nav class="c-tabs" aria-label="Main navigation">
      ${cTab("home", "record", "Capture")}
      ${cTab("recordings", "create", "Create")}
      ${cTab("melodies", "melody", "Listen")}
    </nav>
  `, "variant-c");
}

function cTab(view, symbol, label) {
  const active = state.view === view || (view === "recordings" && state.view === "create");
  return `<button class="${active ? "active" : ""}" data-action="view" data-value="${view}">${icon(symbol)}<span>${label}</span></button>`;
}

function renderSwitcher(current) {
  if (!location.pathname.includes("/prototype/")) return;
  const target = document.querySelector("#prototype-switcher");
  target.innerHTML = `
    <div class="prototype-switcher">
      <button data-switch="-1" aria-label="Previous variant">←</button>
      <span><small>PROTOTYPE</small><strong>${current} — ${variantMeta[current].name}</strong></span>
      <button data-switch="1" aria-label="Next variant">→</button>
    </div>
  `;
  target.querySelectorAll("[data-switch]").forEach((button) => {
    button.addEventListener("click", () => cycleVariant(Number(button.dataset.switch)));
  });
}

function bindActions() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => act(button.dataset.action, button.dataset));
  });
}

function act(action, data) {
  state.toast = "";
  if (action === "view") {
    state.view = data.value;
    if (data.value === "recordings" && getVariant() === "C") state.wizardStep = 1;
  }
  if (action === "record") {
    state.recording = !state.recording;
    if (!state.recording) {
      state.recordings.unshift({ id: Date.now(), name: "Fresh Recording", duration: "1.3s", tone: "Mid", selected: false });
      state.toast = "Recording saved locally";
    }
  }
  if (action === "toggle-source") {
    const recording = state.recordings.find((item) => item.id === Number(data.id));
    if (recording) recording.selected = !recording.selected;
  }
  if (action === "delete-recording") {
    state.recordings = state.recordings.filter((item) => item.id !== Number(data.id));
    state.toast = "Recording deleted";
  }
  if (action === "delete-melody") {
    state.melodies = state.melodies.filter((item) => item.id !== Number(data.id));
    state.toast = "Created Melody deleted";
  }
  if (action === "play-recording") togglePlaying(`recording-${data.id}`);
  if (action === "play-melody") togglePlaying(`melody-${data.id}`);
  if (action === "creator") state.creator = data.value;
  if (action === "recommend") {
    state.recordings.forEach((item, index) => (item.selected = index < 3));
    state.toast = "Best-fit set recommended";
  }
  if (action === "wizard-next") {
    state.wizardStep = 2;
    state.view = "create";
  }
  if (action === "wizard-back") {
    state.wizardStep = 1;
    state.view = "recordings";
  }
  if (action === "create-melody") {
    const ai = state.creator === "ai";
    state.melodies.unshift({
      id: Date.now(),
      name: ai ? "New AI Melody" : "Twinkle, Twinkle",
      kind: ai ? "AI Song Creator" : "Song Creator",
      duration: ai ? "0:21" : "0:18",
    });
    state.view = "melodies";
    state.wizardStep = 1;
    state.toast = "Created Melody saved locally";
  }
  render();
}

function togglePlaying(key) {
  state.playing = state.playing === key ? null : key;
}

window.addEventListener("keydown", (event) => {
  const tag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA"].includes(tag) || document.activeElement?.isContentEditable) return;
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});

window.addEventListener("popstate", render);
render();
