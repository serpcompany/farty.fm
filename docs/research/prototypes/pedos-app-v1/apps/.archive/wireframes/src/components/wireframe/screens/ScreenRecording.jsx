import { Circle, Mic, TriangleAlert, X } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

function WaveBars() {
  const bars = [22, 44, 30, 58, 38, 50, 28, 36, 20];

  return (
    <div className="mt-6 flex h-28 items-end justify-center gap-2 rounded-[24px] border border-gray-200 bg-gray-50 px-6 pb-6 pt-4">
      {bars.map((height, index) => (
        <div
          key={`${height}-${index}`}
          className="w-4 rounded-t-full bg-gray-300"
          style={{ height }}
        />
      ))}
    </div>
  );
}

export default function ScreenRecording({ variant = "active", onNavigate }) {
  const isFailed = variant === "failed";
  const isCanceled = variant === "canceled";

  if (isFailed || isCanceled) {
    return (
      <div className="flex h-full flex-col bg-white">
        <WireTopBar title="Recording" showBack onBack={() => onNavigate("home")} />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-gray-100">
            {isFailed ? (
              <TriangleAlert className="h-8 w-8 text-gray-500" />
            ) : (
              <X className="h-8 w-8 text-gray-500" />
            )}
          </div>
          <div className="mt-6 text-[24px] font-bold text-gray-900">
            {isFailed ? "Recording failed." : "Recording canceled."}
          </div>
          <div className="mt-3 text-[13px] leading-relaxed text-gray-500">
            {isFailed
              ? "Show a clear recovery path when recording crashes or loses access."
              : "Cancel should exit cleanly without leaving temp state behind."}
          </div>
          <div className="mt-8 grid w-full gap-3">
            <button type="button" className="wire-button-primary w-full" onClick={() => onNavigate("recording")}>
              Try again
            </button>
            <button type="button" className="wire-button-secondary w-full" onClick={() => onNavigate("home")}>
              Back to home
            </button>
          </div>
        </div>

        <WireBottomNav active="home" onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <WireTopBar
        title="Recording"
        showBack
        onBack={() => onNavigate("home")}
        rightAction={<div className="wire-chip">Live</div>}
      />

      <div className="flex flex-1 flex-col px-6 pb-8 pt-10">
        <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border-[10px] border-gray-900 bg-gray-50">
          <Mic className="h-10 w-10 text-gray-800" />
        </div>

        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-2 text-[12px] uppercase tracking-[0.18em] text-gray-400">
            <Circle className="h-3 w-3 fill-gray-900 text-gray-900" />
            recording in progress
          </div>
          <div className="mt-3 text-[40px] font-bold tracking-tight text-gray-900">00:07.8</div>
        </div>

        <WaveBars />

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" className="wire-button-secondary w-full" onClick={() => onNavigate("recording-canceled")}>
            Cancel
          </button>
          <button type="button" className="wire-button-primary w-full" onClick={() => onNavigate("review")}>
            Stop
          </button>
        </div>
      </div>

      <WireBottomNav active="home" onNavigate={onNavigate} />
    </div>
  );
}
