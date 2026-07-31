import { ArrowRight, Music4, Play, Sparkles, TriangleAlert } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

function SectionTitle({ eyebrow, title, body }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">{eyebrow}</div>
      <div className="mt-1 text-[22px] font-bold leading-[1.05] text-gray-900">{title}</div>
      <div className="mt-3 text-[13px] leading-relaxed text-gray-500">{body}</div>
    </div>
  );
}

function OptionCard({ title, body, badge = null, selected = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        selected
          ? "wire-card w-full border-gray-900 bg-gray-50 p-4 text-left"
          : "wire-card w-full p-4 text-left transition-colors hover:bg-gray-50"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-gray-900">{title}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-gray-500">{body}</div>
        </div>
        {badge ? <div className="wire-chip">{badge}</div> : null}
      </div>
    </button>
  );
}

function FakeInput({ value }) {
  return <div className="wire-field">{value}</div>;
}

export default function ScreenPedosAI({ variant = "home", onNavigate }) {
  if (variant === "home") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar title="Pedos AI" showBack onBack={() => onNavigate("home")} />

        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6">
          <SectionTitle
            eyebrow="Creative mode"
            title="Turn saved farts into a song."
            body="Pedos AI is the playful phase-two layer. It should feel like a creative tool built on top of the recording history, not a replacement for the core app."
          />

          <div className="mt-6 wire-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">
                  Eligible clips
                </div>
                <div className="mt-1 text-[24px] font-bold text-gray-900">128</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-gray-100">
                <Music4 className="h-5 w-5 text-gray-500" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-[16px] bg-gray-50 p-3">
                <div className="text-[16px] font-bold text-gray-900">All</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-gray-400">
                  use every clip
                </div>
              </div>
              <div className="rounded-[16px] bg-gray-50 p-3">
                <div className="text-[16px] font-bold text-gray-900">Pick</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-gray-400">
                  choose clips
                </div>
              </div>
              <div className="rounded-[16px] bg-gray-50 p-3">
                <div className="text-[16px] font-bold text-gray-900">AI</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-gray-400">
                  smart choose
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[18px] border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Song flow</div>
            <div className="mt-2 text-[12px] leading-relaxed text-gray-500">
              Pick clips first, then choose whether Pedos AI makes an original song or a
              cover-style version from the same source set.
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 pb-8 pt-4">
          <button
            type="button"
            onClick={() => onNavigate("pedos-ai-clip-source")}
            className="wire-button-primary w-full"
          >
            Start song flow
          </button>
        </div>

        <WireBottomNav active="pedos-ai" onNavigate={onNavigate} />
      </div>
    );
  }

  if (variant === "clip-source") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar title="Clip source" showBack onBack={() => onNavigate("pedos-ai-home")} />

        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6">
          <SectionTitle
            eyebrow="Step 1"
            title="Choose the fart clips to use."
            body="The flow should make the source choice explicit before generation begins."
          />

          <div className="mt-6 space-y-3">
            <OptionCard
              title="Use all farts"
              body="Take everything in the user’s saved history and build from the full archive."
              selected
              onClick={() => onNavigate("pedos-ai-song-type")}
            />
            <OptionCard
              title="Choose farts to use"
              body="Let the user manually pick clips from their saved history."
              badge="Manual"
              onClick={() => onNavigate("pedos-ai-song-type")}
            />
            <OptionCard
              title="AI smart choose"
              body="Let AI choose the strongest set of clips, but still give the user a review step."
              badge="AI"
              onClick={() => onNavigate("pedos-ai-smart-choose")}
            />
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 pb-8 pt-4">
          <button
            type="button"
            onClick={() => onNavigate("pedos-ai-song-type")}
            className="wire-button-primary w-full"
          >
            Continue with selected source
          </button>
        </div>

        <WireBottomNav active="pedos-ai" onNavigate={onNavigate} />
      </div>
    );
  }

  if (variant === "smart-choose") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar
          title="AI smart choose"
          showBack
          onBack={() => onNavigate("pedos-ai-clip-source")}
        />

        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6">
          <SectionTitle
            eyebrow="AI review"
            title="AI picked the clips below."
            body="This review step keeps the user in control before generation starts."
          />

          <div className="mt-6 space-y-3">
            {[
              "Today · 8:12 AM · 8 sec",
              "Yesterday · 11:44 PM · 4 sec",
              "Tuesday · 2:17 PM · 6 sec",
            ].map((item) => (
              <div key={item} className="wire-card flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[13px] font-semibold text-gray-900">{item}</div>
                  <div className="text-[11px] text-gray-400">Selected for variation and rhythm</div>
                </div>
                <div className="wire-chip">keep</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 pb-8 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onNavigate("pedos-ai-clip-source")}
              className="wire-button-secondary w-full"
            >
              Re-pick
            </button>
            <button
              type="button"
              onClick={() => onNavigate("pedos-ai-song-type")}
              className="wire-button-primary w-full"
            >
              Use these clips
            </button>
          </div>
        </div>

        <WireBottomNav active="pedos-ai" onNavigate={onNavigate} />
      </div>
    );
  }

  if (variant === "song-type") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar title="Song type" showBack onBack={() => onNavigate("pedos-ai-clip-source")} />

        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6">
          <SectionTitle
            eyebrow="Step 2"
            title="Choose the kind of song to generate."
            body="Let the user choose between an original song and a cover-style version from the same selected clips."
          />

          <div className="mt-6 space-y-3">
            <OptionCard
              title="Original song"
              body="Generate a brand-new track inspired by the selected fart clips."
              selected
              onClick={() => onNavigate("pedos-ai-original-prompt")}
            />
            <OptionCard
              title="Cover-style concept"
              body="User types an artist name, song name, or both to shape the generated result."
              onClick={() => onNavigate("pedos-ai-cover-input")}
            />
          </div>
        </div>

        <WireBottomNav active="pedos-ai" onNavigate={onNavigate} />
      </div>
    );
  }

  if (variant === "original-prompt") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar
          title="Original song"
          showBack
          onBack={() => onNavigate("pedos-ai-song-type")}
        />

        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6">
          <SectionTitle
            eyebrow="Step 3"
            title="Give Pedos AI a direction."
            body="Keep the first version lightweight: a few creative controls plus a generate action."
          />

          <div className="mt-6 space-y-3">
            <FakeInput value="Mood: triumphant and goofy" />
            <FakeInput value="Genre: disco-funk" />
            <FakeInput value="Optional note: build around the loudest clips" />
          </div>

          <div className="mt-5 rounded-[18px] border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Source</div>
            <div className="mt-2 text-[12px] leading-relaxed text-gray-500">
              AI smart choose selected 3 clips for this request.
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 pb-8 pt-4">
          <button
            type="button"
            onClick={() => onNavigate("pedos-ai-generating")}
            className="wire-button-primary w-full"
          >
            Generate original song
          </button>
        </div>

        <WireBottomNav active="pedos-ai" onNavigate={onNavigate} />
      </div>
    );
  }

  if (variant === "cover-input") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar
          title="Cover-style concept"
          showBack
          onBack={() => onNavigate("pedos-ai-song-type")}
        />

        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6">
          <SectionTitle
            eyebrow="Step 3"
            title="Add the artist or song reference."
            body="Let the user type an artist name, song name, or both before generation starts."
          />

          <div className="mt-6 space-y-3">
            <FakeInput value="Artist name" />
            <FakeInput value="Song name" />
            <FakeInput value="Optional style note" />
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 pb-8 pt-4">
          <button
            type="button"
            onClick={() => onNavigate("pedos-ai-generating")}
            className="wire-button-primary w-full"
          >
            Generate cover-style song
          </button>
        </div>

        <WireBottomNav active="pedos-ai" onNavigate={onNavigate} />
      </div>
    );
  }

  if (variant === "generating") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar title="Generating" showBack onBack={() => onNavigate("pedos-ai-home")} />

        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-gray-100">
            <Sparkles className="h-8 w-8 text-gray-500" />
          </div>

          <div className="mt-6 text-[24px] font-bold text-gray-900">Pedos AI is making the track.</div>
          <div className="mt-3 text-[13px] leading-relaxed text-gray-500">
            This should feel like an async job state, not a frozen screen.
          </div>

          <div className="mt-6 h-3 w-full max-w-[260px] overflow-hidden rounded-full bg-gray-100">
            <div className="h-full w-2/3 rounded-full bg-gray-400" />
          </div>

          <div className="mt-6 space-y-2 text-[12px] text-gray-500">
            <div>Choosing clips</div>
            <div>Shaping prompt</div>
            <div>Generating song output</div>
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 pb-8 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onNavigate("pedos-ai-failed")}
              className="wire-button-secondary w-full"
            >
              View failed state
            </button>
            <button
              type="button"
              onClick={() => onNavigate("pedos-ai-result")}
              className="wire-button-primary w-full"
            >
              View result
            </button>
          </div>
        </div>

        <WireBottomNav active="pedos-ai" onNavigate={onNavigate} />
      </div>
    );
  }

  if (variant === "failed") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar title="Generation failed" showBack onBack={() => onNavigate("pedos-ai-home")} />

        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-gray-100">
            <TriangleAlert className="h-8 w-8 text-gray-500" />
          </div>
          <div className="mt-6 text-[24px] font-bold text-gray-900">The song did not finish.</div>
          <div className="mt-3 text-[13px] leading-relaxed text-gray-500">
            Keep the generation request visible and give the user a retry path.
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 pb-8 pt-4">
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => onNavigate("pedos-ai-generating")}
              className="wire-button-primary w-full"
            >
              Retry generation
            </button>
            <button
              type="button"
              onClick={() => onNavigate("pedos-ai-home")}
              className="wire-button-secondary w-full"
            >
              Back to Pedos AI
            </button>
          </div>
        </div>

        <WireBottomNav active="pedos-ai" onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <WireTopBar title="Generated song" showBack onBack={() => onNavigate("pedos-ai-home")} />

      <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6">
        <SectionTitle
          eyebrow="Result"
          title="Funk of the Fallen Thunder"
          body="Result screens should make it obvious what source mode the song used and what kind of generation was requested."
        />

        <div className="mt-6 wire-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Mode</div>
              <div className="mt-1 text-[16px] font-semibold text-gray-900">Original song</div>
            </div>
            <div className="wire-chip">AI smart choose</div>
          </div>

          <div className="mt-4 flex h-24 items-end gap-2 rounded-[18px] bg-gray-50 px-4 pb-4 pt-3">
            {[28, 44, 36, 52, 26, 38, 30, 48].map((height, index) => (
              <div
                key={`${height}-${index}`}
                className="w-full rounded-t-full bg-gray-300"
                style={{ height }}
              />
            ))}
          </div>

          <button type="button" className="wire-button-primary mt-4 w-full">
            <Play className="mr-2 h-4 w-4" />
            Play generated song
          </button>
        </div>

        <div className="mt-4 wire-card p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Source summary</div>
          <div className="mt-3 space-y-2 text-[12px] text-gray-500">
            <div>3 clips selected</div>
            <div>Mood: triumphant and goofy</div>
            <div>Genre: disco-funk</div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 px-5 pb-8 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigate("pedos-ai-home")}
            className="wire-button-secondary w-full"
          >
            Back
          </button>
          <button type="button" className="wire-button-primary w-full">
            Save result
          </button>
        </div>
      </div>

      <WireBottomNav active="pedos-ai" onNavigate={onNavigate} />
    </div>
  );
}
