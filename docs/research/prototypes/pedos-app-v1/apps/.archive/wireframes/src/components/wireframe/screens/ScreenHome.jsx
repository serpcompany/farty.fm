import { Mic, Play, ShieldAlert, Sparkles } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

function StatCard({ label, value }) {
  return (
    <div className="wire-card p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">{label}</div>
      <div className="mt-2 text-[22px] font-bold text-gray-900">{value}</div>
    </div>
  );
}

export default function ScreenHome({ variant = "default", onNavigate }) {
  const showEmpty = variant === "empty";
  const showPermissionWarning = variant === "no-permission";

  return (
    <div className="flex h-full flex-col bg-white">
      <WireTopBar title="Pedos" showProfile showNotif />

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4">
          <div className="wire-card overflow-hidden">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Record now</div>
              <div className="mt-1 text-[20px] font-bold text-gray-900">
                Fast capture for the next historic event.
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate(showPermissionWarning ? "permission-education" : "recording")}
              className="flex w-full items-center gap-4 px-4 py-5 text-left"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-gray-900">
                <Mic className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-semibold text-gray-900">Start recording</div>
                <div className="mt-1 text-[12px] text-gray-500">
                  {showPermissionWarning ? "Microphone access still needs approval." : "One tap into the live recording screen."}
                </div>
              </div>
            </button>
          </div>

          {showPermissionWarning ? (
            <div className="mt-4 rounded-[18px] border border-gray-300 bg-gray-100 px-4 py-3">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 text-gray-500" />
                <div className="text-[12px] leading-relaxed text-gray-500">
                  Without mic permission the main record action should route back into the permission flow.
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="wire-section-label">Quick stats</div>
        <div className="grid grid-cols-3 gap-3 px-4">
          <StatCard label="Total" value="128" />
          <StatCard label="This week" value="9" />
          <StatCard label="Minutes" value="14" />
        </div>

        <div className="wire-section-label">Recent clips</div>
        <div className="border-y border-gray-100">
          {showEmpty ? (
            <div className="px-4 py-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-gray-100">
                <Sparkles className="h-5 w-5 text-gray-500" />
              </div>
              <div className="mt-4 text-[14px] font-semibold text-gray-900">No legendary moments yet</div>
              <div className="mt-2 text-[12px] leading-relaxed text-gray-500">
                First-time users should see an encouraging empty state here.
              </div>
            </div>
          ) : (
            [
              { label: "8:12 AM", meta: "Today · 8 sec" },
              { label: "11:44 PM", meta: "Yesterday · 4 sec" },
              { label: "2:17 PM", meta: "Tuesday · 6 sec" },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onNavigate("detail")}
                className="flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3.5 text-left last:border-b-0"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-gray-100">
                  <Play className="h-4 w-4 text-gray-500" />
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-gray-900">{item.label}</div>
                  <div className="text-[11px] text-gray-400">{item.meta}</div>
                </div>
                <div className="wire-chip">play</div>
              </button>
            ))
          )}
        </div>
      </div>

      <WireBottomNav active="home" onNavigate={onNavigate} />
    </div>
  );
}
