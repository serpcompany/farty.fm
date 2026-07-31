import { Music4, Save, TriangleAlert } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

function MetaRow({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-3 last:border-b-0">
      <span className="text-[12px] uppercase tracking-[0.18em] text-gray-400">{label}</span>
      <span className="text-[13px] font-medium text-gray-700">{value}</span>
    </div>
  );
}

export default function ScreenReview({ variant = "default", onNavigate }) {
  const isSaving = variant === "saving";
  const isFailed = variant === "failed";

  return (
    <div className="flex h-full flex-col bg-white">
      <WireTopBar title="Review clip" showBack onBack={() => onNavigate("recording")} />

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {isFailed ? (
          <div className="rounded-[18px] border border-gray-300 bg-gray-100 px-4 py-3">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-gray-500" />
              <div className="text-[12px] leading-relaxed text-gray-500">
                Saving failed. Keep the clip visible and give the user a clear retry.
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 wire-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Playback preview</div>
              <div className="mt-1 text-[16px] font-semibold text-gray-900">Today · 8 sec</div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-gray-100">
              <Music4 className="h-5 w-5 text-gray-500" />
            </div>
          </div>

          <div className="mt-4 flex h-24 items-end gap-2 rounded-[18px] bg-gray-50 px-4 pb-4 pt-3">
            {[20, 30, 22, 40, 28, 44, 26, 36].map((height, index) => (
              <div
                key={`${height}-${index}`}
                className="w-full rounded-t-full bg-gray-300"
                style={{ height }}
              />
            ))}
          </div>
        </div>

        <div className="mt-4 wire-card px-4">
          <MetaRow label="Captured" value="Today, 8:12 AM" />
          <MetaRow label="Duration" value="8 seconds" />
          <MetaRow label="Intensity" value="Medium" />
        </div>

        <div className="mt-4 space-y-3">
          <div className="wire-field">Optional note</div>
          <div className="wire-field">Intensity tag selector</div>
        </div>

        <div className="mt-4 rounded-[18px] border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <Music4 className="mt-0.5 h-4 w-4 text-gray-500" />
            <div className="text-[12px] leading-relaxed text-gray-500">
              Future AI song features can hang off saved clips later. They should not affect MVP save flow.
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 px-4 pb-8 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="wire-button-secondary w-full" onClick={() => onNavigate("home")}>
            Discard
          </button>
          <button
            type="button"
            className="wire-button-primary w-full"
            onClick={() => onNavigate(isSaving ? "history" : "review-saving")}
          >
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "Saving..." : "Save clip"}
          </button>
        </div>
        {isSaving ? (
          <button
            type="button"
            onClick={() => onNavigate("review-failed")}
            className="mt-4 text-[12px] font-medium text-gray-500"
          >
            View failed save state
          </button>
        ) : null}
      </div>

      <WireBottomNav active="home" onNavigate={onNavigate} />
    </div>
  );
}
