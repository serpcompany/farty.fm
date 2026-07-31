import { ArrowRight, Mic, Sparkles, TriangleAlert } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

function ShortcutCard({ title, body, phrase, onClick, cta }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="wire-card w-full p-4 text-left transition-colors hover:bg-gray-50"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-gray-100">
          <Sparkles className="h-5 w-5 text-gray-500" />
        </div>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-gray-900">{title}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-gray-500">{body}</div>
          <div className="mt-3 inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[11px] font-medium text-gray-600">
            “{phrase}”
          </div>
          <div className="mt-4 flex items-center gap-2 text-[12px] font-medium text-gray-500">
            {cta}
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    </button>
  );
}

export default function ScreenQuickRecord({ variant = "trigger", onNavigate }) {
  if (variant === "fallback") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar title="Quick record" showBack onBack={() => onNavigate("home")} />

        <div className="flex flex-1 flex-col px-5 pb-8 pt-6">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] bg-gray-100">
            <TriangleAlert className="h-8 w-8 text-gray-500" />
          </div>

          <div className="mt-6 text-center">
            <div className="text-[25px] font-bold leading-[1.05] text-gray-900">
              Quick record needs microphone access first.
            </div>
            <div className="mt-3 text-[13px] leading-relaxed text-gray-500">
              This is the Siri / Shortcuts fallback path. The product should not land in a broken
              recording state when permission is missing.
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className="wire-card p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Invoked by</div>
              <div className="mt-2 text-[16px] font-semibold text-gray-900">“Record with Pedos”</div>
              <div className="mt-2 text-[12px] text-gray-500">
                Siri launched the shortcut, but mic access is still off.
              </div>
            </div>
            <div className="wire-card p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Recovery path</div>
              <div className="mt-2 text-[12px] leading-relaxed text-gray-500">
                Route the user into the microphone education screen, then back into recording once
                permission is granted.
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 pb-8 pt-4">
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => onNavigate("permission-education")}
              className="wire-button-primary w-full"
            >
              Go to permission flow
            </button>
            <button
              type="button"
              onClick={() => onNavigate("quick-record-trigger")}
              className="wire-button-secondary w-full"
            >
              Back to shortcut concept
            </button>
          </div>
        </div>

        <WireBottomNav active="home" onNavigate={onNavigate} />
      </div>
    );
  }

  if (variant === "active") {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar title="Quick record" showBack onBack={() => onNavigate("home")} />

        <div className="flex flex-1 flex-col px-5 pb-8 pt-6">
          <div className="wire-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">
                  Shortcut invoked
                </div>
                <div className="mt-1 text-[18px] font-semibold text-gray-900">
                  Recording started immediately
                </div>
              </div>
              <div className="wire-chip">Siri</div>
            </div>
            <div className="mt-3 text-[12px] leading-relaxed text-gray-500">
              This screen shows the cleanest quick-record result when permission already exists.
            </div>
          </div>

          <div className="mt-6 flex flex-1 flex-col items-center justify-center">
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-[10px] border-gray-900 bg-gray-50">
              <Mic className="h-10 w-10 text-gray-800" />
            </div>
            <div className="mt-5 text-[12px] uppercase tracking-[0.18em] text-gray-400">
              live recording
            </div>
            <div className="mt-2 text-[40px] font-bold tracking-tight text-gray-900">00:03.2</div>

            <div className="mt-6 flex h-24 w-full items-end gap-2 rounded-[24px] border border-gray-200 bg-gray-50 px-5 pb-5 pt-4">
              {[18, 32, 26, 46, 28, 38, 24, 42].map((height, index) => (
                <div
                  key={`${height}-${index}`}
                  className="w-full rounded-t-full bg-gray-300"
                  style={{ height }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 pb-8 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onNavigate("quick-record-trigger")}
              className="wire-button-secondary w-full"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => onNavigate("review")}
              className="wire-button-primary w-full"
            >
              Stop and review
            </button>
          </div>
        </div>

        <WireBottomNav active="home" onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <WireTopBar title="Quick record" showBack onBack={() => onNavigate("home")} />

      <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6">
        <div className="text-center">
          <div className="text-[25px] font-bold leading-[1.05] text-gray-900">
            Fastest clean iPhone record flow
          </div>
          <div className="mt-3 text-[13px] leading-relaxed text-gray-500">
            Don’t invent a custom wake word. Use Siri and App Shortcuts to get the user into
            recording immediately.
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <ShortcutCard
            title="Siri phrase"
            body="User says the shortcut phrase and drops directly into recording."
            phrase="Record with Pedos"
            cta="Preview successful quick record"
            onClick={() => onNavigate("quick-record-active")}
          />
          <ShortcutCard
            title="Home Screen / Action button"
            body="The same shortcut should also be reusable from the Action button or a Home Screen shortcut."
            phrase="Quick record"
            cta="Preview permission fallback"
            onClick={() => onNavigate("quick-record-fallback")}
          />
        </div>

        <div className="mt-6 rounded-[18px] border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Recommendation</div>
          <div className="mt-2 text-[12px] leading-relaxed text-gray-500">
            Phrase direction should stay close to “Record with Pedos” or “Start recording in Pedos.”
            The shortcut should either start recording immediately or land in a clearly record-ready
            state.
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 px-5 pb-8 pt-4">
        <button
          type="button"
          onClick={() => onNavigate("quick-record-active")}
          className="wire-button-primary w-full"
        >
          Simulate quick record
        </button>
      </div>

      <WireBottomNav active="home" onNavigate={onNavigate} />
    </div>
  );
}
