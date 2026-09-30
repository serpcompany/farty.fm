(() => {
  const D = window.PROTO;
  const REC = Object.fromEntries(D.recordings.map((r) => [r.id, r]));
  const SONG = Object.fromEntries(D.songs.map((s) => [s.id, s]));
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const SHARP = new Set([1, 3, 6, 8, 10]);
  const noteName = (m) => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  const phone = document.getElementById("phone");
  const audio = document.getElementById("audio");

  const STARTS = {
    new: { label: "New user", recs: [], melodies: [], firstRun: true },
    few: { label: "3 Recordings", recs: D.story.slice(0, 3), melodies: [] },
    all: {
      label: "All 23",
      recs: D.recordings.map((r) => r.id),
      melodies: [
        { id: "m1", title: "Twinkle, Twinkle, Little Star", origin: "Twinkle, Twinkle, Little Star", song: "twinkle", when: "Today" },
        { id: "m2", title: "Spooky tune", origin: "AI · Spooky", song: null, when: "Yesterday" },
      ],
    },
  };
  const RULES = {
    stars: { label: "Unlock + progress (proposed)", desc: "Unlocked when every note can be reached within 5 semitones of one of your Melodic Recordings. The progress bar shows how many notes have a fart within 1 semitone (for example 3 of 5 notes matched)." },
    strict: { label: "All pitches within 3", desc: "The current #43 starting point. A Song unlocks only when every note has a Melodic Recording within 3 semitones." },
  };

  let S;
  let nextId = 100;
  function reset(start) {
    const st = STARTS[start];
    S = {
      start, rule: S?.rule || "stars", tab: "record", seg: "songs", recording: false, push: null, modal: null, alert: null, toast: null,
      recs: st.recs.map((id, i) => ({ key: "r" + i, id, n: i + 1 })),
      story: st.recs.length ? Math.min(st.recs.length, D.story.length) : 0,
      melodies: st.melodies.map((m) => ({ ...m })),
      mic: st.firstRun ? null : true, firstRun: !!st.firstRun, playing: null, search: "", sort: "closest",
      ai: { mood: "Happy", len: "Short", result: null, busy: false }, draft: null, result: null, making: false,
    };
    if (S.firstRun) S.modal = "welcome";
    stop();
    render();
  }

  // ---------------------------------------------------------------- Melody Fit preview
  const melodic = (recs = S.recs) => recs.map((r) => REC[r.id]).filter((r) => r.melodic).map((r) => r.midi);
  function fit(song, recs) {
    const mids = melodic(recs), ps = song.pitches, total = ps.length;
    if (!mids.length) return { unlocked: false, have: 0, total, stars: 0, missing: [], none: true };
    const dist = (p) => Math.min(...mids.map((r) => Math.abs(p - r)));
    let best = null;
    for (let t = -36; t <= 24; t++) {
      const d = ps.map((p) => dist(p + t));
      if (S.rule === "stars") {
        const playable = d.every((x) => x <= 5), matched = d.filter((x) => x <= 1).length, reach = d.filter((x) => x <= 5).length;
        const score = playable ? 1000 + matched * 10 - d.reduce((a, b) => a + b, 0) / 100 : reach * 10 - d.reduce((a, b) => a + b, 0) / 100;
        if (!best || score > best.score) best = { score, t, d, playable, matched, reach };
      } else {
        const have = d.filter((x) => x <= 3).length, score = have * 10 - d.reduce((a, b) => a + b, 0) / 100;
        if (!best || score > best.score) best = { score, t, d, have };
      }
    }
    if (S.rule === "stars") {
      const stars = !best.playable ? 0 : best.matched === total ? 3 : best.matched >= total / 2 ? 2 : 1;
      const miss = ps.map((p, i) => [p + best.t, best.d[i]]).filter(([, x]) => (best.playable ? x > 1 : x > 5)).map(([m]) => m);
      return { unlocked: best.playable, have: best.playable ? best.matched : best.reach, total, stars, missing: miss };
    }
    const miss = ps.map((p, i) => [p + best.t, best.d[i]]).filter(([, x]) => x > 3).map(([m]) => m);
    return { unlocked: best.have === total, have: best.have, total, stars: best.have === total ? 1 : 0, missing: miss };
  }
  const bar = (f) => `<span class="pbar" role="img" aria-label="${f.have} of ${f.total}"><i style="width:${Math.round((100 * f.have) / f.total)}%"></i></span>`;
  const progressText = (f) => S.rule === "stars" ? (f.unlocked ? `${f.have} of ${f.total} notes matched` : `${f.have} of ${f.total} notes reachable`) : `${f.have} of ${f.total} pitches`;
  const needText = (f) => f.none ? "Record a fart with a clear note to start" : f.missing.length ? "Needs a fart near " + [...new Set(f.missing.map(noteName))].slice(0, 3).join(", ") : "";

  // ---------------------------------------------------------------- audio
  let raf = 0;
  function play(key, src) {
    if (S.playing === key) return stop(true);
    audio.src = src;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    S.playing = key;
    render();
    cancelAnimationFrame(raf);
    const tick = () => { drawNotes(); if (!audio.paused) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  function stop(rerender) { audio.pause(); if (S) S.playing = null; if (rerender) render(); }
  audio.addEventListener("ended", () => { S.playing = null; render(); });

  // ---------------------------------------------------------------- pieces
  const icon = {
    record: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>',
    recordings: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16M4 15h16"/></svg>',
    create: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
    melodies: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg>',
  };
  const recName = (r) => `Recording ${r.n}`;
  function strip(haveSet, needSet = new Set()) {
    return `<div class="strip" aria-hidden="true">${NAMES.map((n, i) => `<span class="${SHARP.has(i) ? "sharp" : ""} ${haveSet.has(i) ? "have" : ""} ${needSet.has(i) && !haveSet.has(i) ? "need" : ""}">${n}</span>`).join("")}</div>`;
  }
  const havePcs = () => new Set(melodic().map((m) => ((Math.round(m) % 12) + 12) % 12));

  function recordTab() {
    const on = S.recording;
    return `<div class="recordpane">
      <button class="hugerec ${on ? "on" : ""}" data-a="${on ? "stoprec" : "record"}" aria-label="${on ? "Stop" : "Record"}"><i></i></button>
      <div class="timer" id="timer" ${on ? "" : "hidden"}>0:00</div>
      ${on ? `<p class="hint">Prototype: your microphone isn't used. Tap again to stop, and you'll get a real test fart.</p>` : ""}
    </div>`;
  }

  function recordings() {
    const pcs = havePcs();
    const rows = [...S.recs].reverse().map((r) => {
      const d = REC[r.id], key = "rec-" + r.key;
      return `<div class="row ${S.playing === key ? "playing" : ""}">
        <button class="play" data-a="playrec" data-k="${r.key}" aria-label="Play ${recName(r)}">${S.playing === key ? "■" : "▶"}</button>
        <div class="grow"><div class="title">${recName(r)}</div><div class="sub">${d.seconds.toFixed(1)} s${d.cut ? " · first fart used" : ""}</div></div>
        ${d.melodic ? `<span class="badge">${noteName(d.midi)}</span>` : `<span class="badge soft">noise-like</span>`}
        <button class="more" data-a="recmenu" data-k="${r.key}" aria-label="More">⋯</button>
      </div>`;
    }).join("");
    return `<div class="navbar"></div>
      <div class="largetitle">Recordings</div>
      ${strip(pcs)}
      <div class="striplabel"><span>${pcs.size} of 12 notes collected</span><span>${S.recs.length} Recording${S.recs.length === 1 ? "" : "s"}</span></div>
      ${S.recs.length ? `<div class="list">${rows}</div>` : `<div class="empty">No Recordings yet.<br>Go to the Record tab and tap the red button.</div>`}`;
  }

  function songsList() {
    const q = S.search.trim().toLowerCase();
    let items = D.songs.filter((s) => s.title.toLowerCase().includes(q)).map((s) => ({ s, f: fit(s, S.recs) }));
    if (S.sort === "az") items.sort((a, b) => a.s.title.localeCompare(b.s.title));
    else items.sort((a, b) => (b.f.unlocked - a.f.unlocked) || (b.f.stars - a.f.stars) || (b.f.have / b.f.total - a.f.have / a.f.total));
    const un = items.filter((x) => x.f.unlocked), lo = items.filter((x) => !x.f.unlocked);
    const row = ({ s, f }) => `<button class="row" data-a="song" data-id="${s.id}">
        <div class="grow"><div class="title">${s.title}</div><div class="sub">${progressText(f)}${!f.unlocked ? " · " + needText(f).replace("Needs a fart", "needs") : ""}</div></div>
        ${f.unlocked ? bar(f) : `<span class="badge soft">🔒</span>`}<span class="chev">›</span></button>`;
    const noMel = !melodic().length;
    return `<div class="search"><input id="search" placeholder="Search Songs" value="${S.search.replace(/"/g, "&quot;")}" aria-label="Search Songs"><select id="sort" aria-label="Sort"><option value="closest" ${S.sort === "closest" ? "selected" : ""}>Closest to unlock</option><option value="az" ${S.sort === "az" ? "selected" : ""}>A–Z</option></select></div>
      ${noMel ? `<div class="empty" style="margin-top:12px">Record a few farts with a clear note to start unlocking Songs.</div>` : ""}
      ${un.length ? `<div class="section">Unlocked · ${un.length}</div><div class="list">${un.map(row).join("")}</div>` : ""}
      ${lo.length ? `<div class="section">Locked · ${lo.length}</div><div class="list">${lo.map(row).join("")}</div>` : ""}
      ${!items.length ? `<div class="empty" style="margin-top:12px">No Songs match "${S.search}".</div>` : ""}`;
  }

  function aiPane() {
    const n = melodic().length;
    if (n < 3) return `<div class="empty">AI needs at least 3 Melodic Recordings.<br>You have ${n}.</div><div style="height:12px"></div><button class="secondary" data-a="record">Record</button>`;
    const a = S.ai;
    const moods = ["Happy", "Silly", "Spooky", "Epic"].map((m) => `<button class="chip" data-a="mood" data-v="${m}" aria-pressed="${a.mood === m}">${m}</button>`).join("");
    return `<p class="meta" style="margin:0 0 4px">A brand-new tune, played only by your farts.</p>
      <div class="section">Mood</div><div class="chips">${moods}</div>
      <div class="section">Length</div><div class="segment">${["Short", "Long"].map((l) => `<button data-a="len" data-v="${l}" aria-pressed="${a.len === l}">${l}</button>`).join("")}</div>
      ${a.busy ? `<div class="empty"><div class="spinner" style="margin:0 auto 10px"></div>Composing…</div>` : a.result ? `
        <canvas class="notes" id="notes"></canvas>
        <p class="meta">Prototype: no AI audio yet. #21 decides how melodies are composed.</p>
        <div class="btnrow"><button class="secondary" data-a="compose">Try again</button><button class="primary" data-a="saveai">Save</button></div>` : `<button class="primary" data-a="compose">Compose</button>`}`;
  }

  function create() {
    return `<div class="navbar"></div><div class="largetitle">Compose</div>
      <div class="segment" role="group" aria-label="Creation area"><button data-a="seg" data-v="songs" aria-pressed="${S.seg === "songs"}">Songs</button><button data-a="seg" data-v="ai" aria-pressed="${S.seg === "ai"}">AI</button></div>
      ${S.seg === "songs" ? songsList() : aiPane()}`;
  }

  function songCreator() {
    const s = SONG[S.push], key = "song-" + s.id;
    const used = S.recs.map((r) => REC[r.id]).filter((r) => r.melodic).slice(0, s.pitches.length).map((r) => r.id);
    return `<div class="navbar"><button class="back" data-a="back">‹ Compose</button></div>
      <div class="largetitle" style="font-size:26px">${s.title}</div>
      <div class="meta">${s.source}</div>
      ${S.making ? `<div class="empty" style="margin-top:14px"><div class="spinner" style="margin:0 auto 10px"></div>Making your melody…</div>` : `
      <div class="player"><button class="play" data-a="playsong" aria-label="Play">${S.playing === key ? "■" : "▶"}</button><div><div class="title">${S.playing === key ? "Playing" : "Ready"}</div><div class="meta">${used.length} of your Recordings${used.length ? "" : " (try-anyway preview)"}</div></div></div>
      <canvas class="notes" id="notes"></canvas>
      <div class="section">Recordings used</div>
      <div class="chips">${used.map((id) => `<button class="chip" data-a="playraw" data-id="${id}">${REC[id].melodic ? noteName(REC[id].midi) : id}</button>`).join("")}</div>
      <button class="primary" data-a="savesong">Save to Melodies</button>`}`;
  }

  function melodies() {
    const rows = S.melodies.map((m) => {
      const key = "mel-" + m.id;
      return `<div class="row ${S.playing === key ? "playing" : ""}"><button class="play" data-a="playmel" data-id="${m.id}" aria-label="Play ${m.title}">${S.playing === key ? "■" : "▶"}</button>
        <div class="grow"><div class="title">${m.title}</div><div class="sub">${m.origin} · ${m.when}</div></div>
        <button class="more" data-a="melmenu" data-id="${m.id}" aria-label="More">⋯</button></div>`;
    }).join("");
    return `<div class="navbar"></div><div class="largetitle">Melodies</div>
      ${S.melodies.length ? `<div class="list">${rows}</div>` : `<div class="empty">Nothing yet.<br>Make one in Compose.</div>`}`;
  }

  // ---------------------------------------------------------------- overlays
  function overlay() {
    const m = S.modal;
    if (m === "welcome") return `<div class="scrim"><div class="sheet"><div class="grabber"></div>
      <h2 style="margin:6px 0 4px;font-size:26px">Pedos</h2><p class="meta" style="font-size:16px;margin:0 0 16px">Record your farts. Turn them into songs.</p>
      <div class="card">● One fart per Recording</div><div style="height:8px"></div>
      <div class="card">♪ Each fart has a note</div><div style="height:8px"></div>
      <div class="card">🔓 Collect notes to unlock Songs</div><div style="height:18px"></div>
      <button class="primary" data-a="allowmic">Allow microphone</button><div style="text-align:center"><button class="linkbtn" data-a="notnow">Not now</button></div></div></div>`;
    if (m === "review") {
      const d = REC[S.draft], key = "draft";
      return `<div class="cover"><div class="card" style="text-align:center;font-size:13px">Prototype: this is test fart #${d.id} from the Fixture Library, not your microphone.</div><div class="center"><div class="meta">New Recording · ${d.seconds.toFixed(1)} s</div>
        <div class="meter">${Array.from({ length: 30 }, (_, i) => `<i style="height:${10 + Math.round(55 * Math.abs(Math.sin(i * 1.7 + d.seconds)))}px"></i>`).join("")}</div>
        <button class="play" style="width:64px;height:64px;font-size:20px" data-a="playdraft">${S.playing === key ? "■" : "▶"}</button></div>
        <div class="btnrow"><button class="secondary" data-a="discard">Discard</button><button class="primary" data-a="save">Save</button></div></div>`;
    }
    if (m === "result") {
      const r = S.result;
      if (r.busy) return `<div class="cover"><div class="center"><div class="spinner"></div><div class="title">Finding your note…</div></div></div>`;
      const d = REC[r.id];
      const news = r.unlocked.length > 2
        ? `<div class="card"><b>🔓 You unlocked ${r.unlocked.length} Songs</b><div class="meta">${r.unlocked.map((id) => SONG[id].title).join(" · ")}</div></div>`
        : r.unlocked.map((id) => `<div class="card"><b>🔓 You unlocked ${SONG[id].title}</b></div>`).join("");
      const ups = r.upgraded.slice(0, 2).map(([id, f]) => `<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><span>${SONG[id].title}</span>${bar(f)}</div><div class="meta">${progressText(f)}</div></div>`).join("");
      const near = !r.unlocked.length && !r.upgraded.length && r.closest && melodic().length ? `<div class="card">${SONG[r.closest.id].title}: ${progressText(r.closest.f)}</div>` : "";
      return `<div class="cover"><div class="center" style="align-content:center;gap:12px">
        ${d.melodic ? `<div class="meta">Your note</div><div class="bignote">${noteName(d.midi)}</div>${strip(havePcs(), new Set([((Math.round(d.midi) % 12) + 12) % 12]))}` : `<div class="bignote" style="font-size:40px">~</div><div class="title">No steady note this time</div><p class="hint">It's saved, but it can't play melody notes.</p>`}
        ${d.cut ? `<p class="hint">We heard more than one fart and kept the first.</p>` : ""}
        <div style="display:grid;gap:8px;width:100%">${news}${ups}${near}</div></div>
        ${r.unlocked.length ? `<div class="btnrow"><button class="secondary" data-a="done">Done</button><button class="primary" data-a="tryit" data-id="${r.unlocked[0]}">Try it</button></div>` : `<div class="btnrow"><button class="secondary" data-a="again">Record another</button><button class="primary" data-a="done">Done</button></div>`}</div>`;
    }
    if (m === "locked") {
      const s = SONG[S.lockedSong], f = fit(s, S.recs);
      const need = new Set(f.missing.map((x) => ((Math.round(x) % 12) + 12) % 12));
      return `<div class="scrim" data-a="closesheet"><div class="sheet" data-stop="1"><div class="grabber"></div>
        <div class="title" style="font-size:20px">${s.title} 🔒</div><div class="meta">${progressText(f)}</div>
        ${strip(havePcs(), need)}<div class="striplabel"><span>■ you have</span><span>▢ needed</span></div>
        <p style="margin:0 0 14px">${needText(f)}.</p>
        <button class="primary" data-a="record">Record</button>
        <div style="text-align:center"><button class="linkbtn" data-a="tryanyway" data-id="${s.id}">Try anyway (may sound off)</button></div></div></div>`;
    }
    return "";
  }

  function alertBox() {
    const a = S.alert;
    if (!a) return "";
    if (a.type === "mic") return `<div class="alertwrap"><div class="alert"><div class="body"><h3>“Pedos” Would Like to Access the Microphone</h3><p>Pedos records your farts so it can turn them into songs.</p></div><div class="acts"><button data-a="micno">Don’t Allow</button><button class="strong" data-a="micyes">Allow</button></div></div></div>`;
    if (a.type === "micoff") return `<div class="alertwrap"><div class="alert"><div class="body"><h3>Microphone is off</h3><p>Pedos needs the microphone to record. Turn it on in Settings.</p></div><div class="acts"><button data-a="closealert">Cancel</button><button class="strong" data-a="settings">Open Settings</button></div></div></div>`;
    if (a.type === "recmenu") return `<div class="alertwrap"><div class="alert"><div class="body"><h3>${recName(S.recs.find((r) => r.key === a.key))}</h3></div><div class="acts stack"><button class="danger" data-a="delrec" data-k="${a.key}">Delete Recording</button><button data-a="closealert">Cancel</button></div></div></div>`;
    if (a.type === "melmenu") { const m = S.melodies.find((x) => x.id === a.id); return `<div class="alertwrap"><div class="alert"><div class="body"><h3>${m.title}</h3></div><div class="acts stack"><button data-a="rename" data-id="${m.id}">Rename</button><button class="danger" data-a="delmel" data-id="${m.id}">Delete</button><button data-a="closealert">Cancel</button></div></div></div>`; }
    if (a.type === "rename") { const m = S.melodies.find((x) => x.id === a.id); return `<div class="alertwrap"><div class="alert"><div class="body"><h3>Rename</h3><input id="renamefield" value="${m.title.replace(/"/g, "&quot;")}" aria-label="Name"></div><div class="acts"><button data-a="closealert">Cancel</button><button class="strong" data-a="dorename" data-id="${m.id}">Save</button></div></div></div>`; }
    return "";
  }

  // ---------------------------------------------------------------- render
  function render() {
    const body = S.push ? songCreator() : S.tab === "record" ? recordTab() : S.tab === "recordings" ? recordings() : S.tab === "create" ? create() : melodies();
    const scroll = phone.querySelector(".content")?.scrollTop || 0;
    phone.innerHTML = `<div class="status"><span>9:41</span><span>▪▪▪ ◔</span></div>
      <div class="content">${body}</div>
      <nav class="tabbar" aria-label="Tabs">${[["record", "Record"], ["recordings", "Recordings"], ["create", "Compose"], ["melodies", "Melodies"]].map(([k, l]) => `<button data-a="tab" data-v="${k}" aria-current="${S.tab === k ? "page" : "false"}">${icon[k]}${l}</button>`).join("")}</nav>
      <div class="homeind"></div>${overlay()}${alertBox()}${S.toast ? `<div class="toast">${S.toast}</div>` : ""}`;
    const c = phone.querySelector(".content"); if (c && !S.resetScroll) c.scrollTop = scroll; S.resetScroll = false;
    const search = document.getElementById("search");
    if (search) {
      search.addEventListener("input", (e) => { S.search = e.target.value; const pos = e.target.selectionStart; render(); const s2 = document.getElementById("search"); s2.focus(); s2.setSelectionRange(pos, pos); });
    }
    document.getElementById("sort")?.addEventListener("change", (e) => { S.sort = e.target.value; render(); });
    document.getElementById("renamefield")?.focus();
    drawNotes();
    renderPanel();
  }

  function drawNotes() {
    const cv = document.getElementById("notes");
    if (!cv) return;
    const notes = S.push ? SONG[S.push].notes : S.ai.result;
    if (!notes) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue("--ink").trim(), line = cs.getPropertyValue("--line").trim(), faint = cs.getPropertyValue("--faint").trim();
    const end = Math.max(...notes.map((n) => n.s + n.d)), lo = Math.min(...notes.map((n) => n.m)) - 1, hi = Math.max(...notes.map((n) => n.m)) + 1;
    const x = (b) => 8 + (b / end) * (w - 16), y = (m) => 8 + ((hi - m) / (hi - lo)) * (h - 16);
    const recs = [...new Set(notes.map((n) => n.r))];
    const bpm = S.push ? SONG[S.push].bpm : 110;
    const now = S.playing && S.push ? audio.currentTime * bpm / 60 : -1;
    ctx.fillStyle = line; for (let b = 0; b <= end; b += 4) ctx.fillRect(x(b), 4, 1, h - 8);
    notes.forEach((n) => {
      const shade = recs.length > 1 ? recs.indexOf(n.r) / (recs.length - 1) : 0;
      ctx.globalAlpha = now >= n.s && now < n.s + n.d ? 1 : 0.35 + 0.45 * (1 - shade);
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.roundRect(x(n.s), y(n.m) - 4, Math.max(4, x(n.s + n.d) - x(n.s) - 2), 8, 4); ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (now >= 0) { ctx.fillStyle = faint; ctx.fillRect(x(now), 0, 2, h); }
  }

  // ---------------------------------------------------------------- recording simulation
  let recTimer = 0, recStart = 0;
  function startRecording() {
    if (S.mic === null) { S.alert = { type: "mic", then: "record" }; return render(); }
    if (S.mic === false) { S.alert = { type: "micoff" }; return render(); }
    stop();
    S.modal = null; S.push = null; S.tab = "record"; S.recording = true; render();
    recStart = performance.now();
    clearInterval(recTimer);
    recTimer = setInterval(() => {
      const t = (performance.now() - recStart) / 1000, el = document.getElementById("timer");
      if (!el) return clearInterval(recTimer);
      el.textContent = `0:${String(Math.floor(t)).padStart(2, "0")}`;
      const b = document.querySelector(".hugerec.on"); if (b) b.style.boxShadow = `0 0 0 ${6 + Math.random() * 18}px color-mix(in srgb, var(--record) 25%, transparent)`;
    }, 90);
  }
  function nextStoryId() {
    const have = new Set(S.recs.map((r) => r.id));
    const pool = [...D.story, ...D.recordings.map((r) => r.id)];
    return pool.find((id) => !have.has(id)) || D.story[S.story % D.story.length];
  }
  function toast(msg) { S.toast = msg; render(); setTimeout(() => { S.toast = null; render(); }, 1600); }

  // ---------------------------------------------------------------- events
  phone.addEventListener("click", (e) => {
    const el = e.target.closest("[data-a]");
    if (!el) return;
    if (el.dataset.a === "closesheet" && e.target.closest("[data-stop]")) return;
    const a = el.dataset.a;
    const act = {
      tab: () => { stop(); if (S.recording) return; S.tab = el.dataset.v; S.push = null; S.resetScroll = true; render(); },
      seg: () => { S.seg = el.dataset.v; render(); },
      record: () => { if (S.tab === "record") return startRecording(); S.modal = null; S.push = null; S.tab = "record"; render(); },
      allowmic: () => { S.modal = null; S.alert = { type: "mic" }; render(); },
      notnow: () => { S.modal = null; render(); },
      micyes: () => { const then = S.alert?.then; S.mic = true; S.alert = null; S.firstRun = false; then ? startRecording() : render(); },
      micno: () => { S.mic = false; S.alert = null; render(); },
      settings: () => { S.mic = true; S.alert = null; toast("Microphone on (pretend Settings)"); },
      closealert: () => { S.alert = null; render(); },
      stoprec: () => { clearInterval(recTimer); S.recording = false; S.draft = nextStoryId(); S.modal = "review"; render(); },
      playdraft: () => play("draft", REC[S.draft].audio),
      discard: () => { stop(); S.modal = null; S.draft = null; toast("Discarded"); },
      save: () => {
        stop();
        const before = Object.fromEntries(D.songs.map((s) => [s.id, fit(s, S.recs)]));
        S.recs.push({ key: "r" + nextId++, id: S.draft, n: S.recs.length ? Math.max(...S.recs.map((r) => r.n)) + 1 : 1 });
        S.story++;
        const after = Object.fromEntries(D.songs.map((s) => [s.id, fit(s, S.recs)]));
        const unlocked = D.songs.filter((s) => !before[s.id].unlocked && after[s.id].unlocked).map((s) => s.id);
        const upgraded = D.songs.filter((s) => before[s.id].unlocked && after[s.id].have > before[s.id].have).map((s) => [s.id, after[s.id]]);
        const locked = D.songs.filter((s) => !after[s.id].unlocked).map((s) => ({ id: s.id, f: after[s.id] })).sort((a, b) => b.f.have / b.f.total - a.f.have / a.f.total);
        S.result = { id: S.draft, busy: true, unlocked, upgraded, closest: locked[0] };
        S.modal = "result"; render();
        setTimeout(() => { S.result.busy = false; render(); }, 900);
      },
      done: () => { S.modal = null; S.tab = "recordings"; S.push = null; render(); },
      again: () => { S.modal = null; S.tab = "record"; render(); },
      tryit: () => { S.modal = null; S.tab = "create"; S.seg = "songs"; openSong(el.dataset.id); },
      playrec: () => { const r = S.recs.find((x) => x.key === el.dataset.k); play("rec-" + r.key, REC[r.id].audio); },
      recmenu: () => { S.alert = { type: "recmenu", key: el.dataset.k }; render(); },
      delrec: () => { stop(); S.recs = S.recs.filter((r) => r.key !== el.dataset.k); S.alert = null; toast("Recording deleted"); },
      song: () => { const s = SONG[el.dataset.id]; fit(s, S.recs).unlocked ? openSong(s.id) : ((S.lockedSong = s.id), (S.modal = "locked"), render()); },
      closesheet: () => { S.modal = null; render(); },
      tryanyway: () => { S.modal = null; openSong(el.dataset.id); },
      back: () => { stop(); S.push = null; render(); },
      playsong: () => play("song-" + S.push, SONG[S.push].audio),
      playraw: () => play("raw-" + el.dataset.id, REC[el.dataset.id].audio),
      savesong: () => { stop(); const s = SONG[S.push]; S.melodies.unshift({ id: "m" + nextId++, title: s.title, origin: s.title, song: s.id, when: "Just now" }); toast("Saved to Melodies"); },
      mood: () => { S.ai.mood = el.dataset.v; render(); },
      len: () => { S.ai.len = el.dataset.v; render(); },
      compose: () => {
        S.ai.busy = true; S.ai.result = null; render();
        setTimeout(() => {
          const mids = melodic().map(Math.round).sort((a, b) => a - b), n = S.ai.len === "Short" ? 16 : 28;
          let i = Math.floor(mids.length / 2), t = 0; const out = [];
          for (let k = 0; k < n; k++) { i = Math.max(0, Math.min(mids.length - 1, i + [-1, 0, 1, 1, -1][Math.floor(Math.random() * 5)])); const d = [1, 1, 0.5, 2][Math.floor(Math.random() * 4)]; out.push({ s: t, d, m: mids[i], r: String(i) }); t += d; }
          S.ai.result = out; S.ai.busy = false; render();
        }, 1200);
      },
      saveai: () => { S.melodies.unshift({ id: "m" + nextId++, title: `${S.ai.mood} tune`, origin: `AI · ${S.ai.mood}`, song: null, when: "Just now" }); S.ai.result = null; toast("Saved to Melodies"); },
      playmel: () => { const m = S.melodies.find((x) => x.id === el.dataset.id); m.song ? play("mel-" + m.id, SONG[m.song].audio) : toast("No AI audio in the prototype"); },
      melmenu: () => { S.alert = { type: "melmenu", id: el.dataset.id }; render(); },
      rename: () => { S.alert = { type: "rename", id: el.dataset.id }; render(); },
      dorename: () => { const m = S.melodies.find((x) => x.id === el.dataset.id); const v = document.getElementById("renamefield").value.trim(); if (v) m.title = v; S.alert = null; render(); },
      delmel: () => { stop(); S.melodies = S.melodies.filter((x) => x.id !== el.dataset.id); S.alert = null; toast("Deleted"); },
    }[a];
    if (act) act();
  });

  function openSong(id) {
    stop(); S.push = id; S.making = true; S.resetScroll = true; render();
    setTimeout(() => { S.making = false; play("song-" + id, SONG[id].audio); }, 1100);
  }

  // ---------------------------------------------------------------- evaluator panel
  function renderPanel() {
    document.getElementById("starts").innerHTML = Object.entries(STARTS).map(([k, v]) => `<button data-start="${k}" aria-pressed="${S.start === k}">${v.label}</button>`).join("");
    document.getElementById("rules").innerHTML = Object.entries(RULES).map(([k, v]) => `<button data-rule="${k}" aria-pressed="${S.rule === k}">${v.label}</button>`).join("");
    document.getElementById("ruledesc").textContent = RULES[S.rule].desc;
  }
  document.getElementById("starts").addEventListener("click", (e) => { const b = e.target.closest("[data-start]"); if (b) reset(b.dataset.start); });
  document.getElementById("rules").addEventListener("click", (e) => { const b = e.target.closest("[data-rule]"); if (b) { S.rule = b.dataset.rule; render(); } });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawNotes);

  reset("new");
})();
