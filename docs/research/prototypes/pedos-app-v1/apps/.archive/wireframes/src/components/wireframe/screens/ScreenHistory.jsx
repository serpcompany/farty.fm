import { Play, Trash2 } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

function HistoryRow({ item, onNavigate }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate("detail")}
      className="flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3.5 text-left last:border-b-0"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-gray-100">
        <Play className="h-4 w-4 text-gray-500" />
      </div>
      <div className="flex-1">
        <div className="text-[13px] font-semibold text-gray-900">{item.title}</div>
        <div className="text-[11px] text-gray-400">{item.meta}</div>
      </div>
      <div className="wire-chip">{item.duration}</div>
    </button>
  );
}

export default function ScreenHistory({ variant = "default", onNavigate }) {
  const isEmpty = variant === "empty";
  const isLoading = variant === "loading";
  const isDeleteConfirm = variant === "delete-confirm";

  const items = [
    { title: "Today · 8:12 AM", meta: "Medium intensity", duration: "0:08" },
    { title: "Yesterday · 11:44 PM", meta: "Light intensity", duration: "0:04" },
    { title: "Tuesday · 2:17 PM", meta: "Bold performance", duration: "0:06" },
  ];

  return (
    <div className="relative flex h-full flex-col bg-white">
      <WireTopBar title="History" showProfile />

      <div className="flex-1 overflow-y-auto">
        <div className="wire-section-label">Saved clips</div>

        {isEmpty ? (
          <div className="px-4 py-10 text-center">
            <div className="text-[14px] font-semibold text-gray-900">Nothing saved yet</div>
            <div className="mt-2 text-[12px] leading-relaxed text-gray-500">
              Empty state should reassure the user and route them back to recording.
            </div>
            <button type="button" onClick={() => onNavigate("home")} className="wire-button-primary mt-5">
              Record first clip
            </button>
          </div>
        ) : isLoading ? (
          <div className="space-y-3 px-4 pt-2">
            {[1, 2, 3].map((item) => (
              <div key={item} className="wire-card p-4">
                <div className="h-3 w-24 rounded-full bg-gray-200" />
                <div className="mt-3 h-10 rounded-[14px] bg-gray-100" />
              </div>
            ))}
          </div>
        ) : (
          <div className="border-y border-gray-100">
            {items.map((item) => (
              <HistoryRow key={item.title} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>

      {isDeleteConfirm ? (
        <div className="absolute inset-0 flex items-end bg-gray-900/15 px-4 pb-24">
          <div className="w-full rounded-[26px] bg-white p-5 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                <Trash2 className="h-4 w-4 text-gray-500" />
              </div>
              <div>
                <div className="text-[15px] font-semibold text-gray-900">Delete this clip?</div>
                <div className="mt-1 text-[12px] leading-relaxed text-gray-500">
                  This should be a confirmation step, not an instant destructive action.
                </div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => onNavigate("history")} className="wire-button-secondary">
                Cancel
              </button>
              <button type="button" onClick={() => onNavigate("history-empty")} className="wire-button-primary">
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <WireBottomNav active="history" onNavigate={onNavigate} />
    </div>
  );
}
