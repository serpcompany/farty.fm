import { BarChart3 } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

function StatBlock({ label, value }) {
  return (
    <div className="wire-card p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">{label}</div>
      <div className="mt-2 text-[26px] font-bold text-gray-900">{value}</div>
    </div>
  );
}

export default function ScreenStats({ variant = "default", onNavigate }) {
  const isEmpty = variant === "empty";

  return (
    <div className="flex h-full flex-col bg-white">
      <WireTopBar title="Stats" showProfile />

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-gray-100">
              <BarChart3 className="h-6 w-6 text-gray-500" />
            </div>
            <div className="mt-5 text-[16px] font-semibold text-gray-900">No data yet</div>
            <div className="mt-2 text-[12px] leading-relaxed text-gray-500">
              Stats stay lightweight for MVP and should communicate value after the first few clips.
            </div>
          </div>
        ) : (
          <>
            <div className="wire-section-label">Summary</div>
            <div className="grid grid-cols-2 gap-3 px-4">
              <StatBlock label="Total clips" value="128" />
              <StatBlock label="This week" value="9" />
              <StatBlock label="Minutes" value="14" />
              <StatBlock label="Longest" value="0:12" />
            </div>

            <div className="wire-section-label">Trend</div>
            <div className="px-4">
              <div className="wire-card p-4">
                <div className="text-[12px] font-semibold text-gray-700">Simple weekly chart</div>
                <div className="mt-4 flex h-40 items-end gap-3 rounded-[18px] bg-gray-50 px-4 pb-4 pt-3">
                  {[40, 72, 58, 92, 46, 80, 66].map((height, index) => (
                    <div key={`${height}-${index}`} className="flex w-full flex-col items-center gap-2">
                      <div className="w-full rounded-t-[14px] bg-gray-300" style={{ height }} />
                      <div className="text-[10px] text-gray-400">
                        {["M", "T", "W", "T", "F", "S", "S"][index]}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <WireBottomNav active="stats" onNavigate={onNavigate} />
    </div>
  );
}
