import { Play, TriangleAlert, Trash2 } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

export default function ScreenDetail({ variant = "default", onNavigate }) {
  const failed = variant === "failed";

  return (
    <div className="flex h-full flex-col bg-white">
      <WireTopBar title="Clip detail" showBack onBack={() => onNavigate("history")} />

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {failed ? (
          <div className="rounded-[18px] border border-gray-300 bg-gray-100 px-4 py-3">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-gray-500" />
              <div className="text-[12px] leading-relaxed text-gray-500">
                Playback failed. Surface retry and error messaging without hiding clip metadata.
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 wire-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Saved recording</div>
              <div className="mt-1 text-[18px] font-semibold text-gray-900">Today · 8:12 AM</div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-gray-100">
              <Play className="h-5 w-5 text-gray-500" />
            </div>
          </div>

          <div className="mt-4 flex h-28 items-end gap-2 rounded-[18px] bg-gray-50 px-4 pb-4 pt-3">
            {[18, 42, 34, 52, 30, 24, 38, 26].map((height, index) => (
              <div
                key={`${height}-${index}`}
                className="w-full rounded-t-full bg-gray-300"
                style={{ height }}
              />
            ))}
          </div>

          <button type="button" onClick={() => onNavigate("detail-playback-failed")} className="wire-button-primary mt-4 w-full">
            <Play className="mr-2 h-4 w-4" />
            Play clip
          </button>
        </div>

        <div className="mt-4 wire-card px-4">
          <div className="flex items-center justify-between border-b border-gray-100 py-3">
            <span className="text-[12px] uppercase tracking-[0.18em] text-gray-400">Duration</span>
            <span className="text-[13px] font-medium text-gray-700">8 seconds</span>
          </div>
          <div className="flex items-center justify-between border-b border-gray-100 py-3">
            <span className="text-[12px] uppercase tracking-[0.18em] text-gray-400">Intensity</span>
            <span className="text-[13px] font-medium text-gray-700">Medium</span>
          </div>
          <div className="flex items-start justify-between py-3">
            <span className="text-[12px] uppercase tracking-[0.18em] text-gray-400">Note</span>
            <span className="max-w-[180px] text-right text-[13px] font-medium text-gray-700">
              Unexpectedly long, strong finish.
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 px-4 pb-8 pt-4">
        <button type="button" onClick={() => onNavigate("history-delete-confirm")} className="wire-button-secondary w-full">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete clip
        </button>
      </div>

      <WireBottomNav active="history" onNavigate={onNavigate} />
    </div>
  );
}
