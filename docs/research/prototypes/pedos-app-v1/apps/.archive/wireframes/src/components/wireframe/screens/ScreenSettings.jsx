import { ChevronRight, LogOut, Shield, Trash2 } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

function SettingRow({ label, meta, warning = false, trailing = null }) {
  return (
    <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3.5 last:border-b-0">
      <div className="flex-1">
        <div className={warning ? "text-[13px] font-semibold text-gray-900" : "text-[13px] font-semibold text-gray-900"}>
          {label}
        </div>
        {meta ? <div className="text-[11px] text-gray-400">{meta}</div> : null}
      </div>
      {trailing ?? <ChevronRight className="h-4 w-4 text-gray-300" />}
    </div>
  );
}

export default function ScreenSettings({ variant = "default", onNavigate }) {
  const signOut = variant === "signout";
  const deleteAccount = variant === "delete-account";

  return (
    <div className="relative flex h-full flex-col bg-white">
      <WireTopBar title="Settings" showProfile />

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-5">
          <div className="wire-card p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Account</div>
            <div className="mt-2 text-[18px] font-semibold text-gray-900">devin@example.com</div>
            <div className="mt-1 text-[12px] text-gray-500">Microphone: granted</div>
          </div>
        </div>

        <div className="wire-section-label">Privacy</div>
        <div className="border-y border-gray-100">
          <SettingRow label="Microphone access" meta="Granted in iPhone Settings" />
          <SettingRow label="Recording behavior" meta="Manual capture only in MVP" trailing={<Shield className="h-4 w-4 text-gray-400" />} />
        </div>

        <div className="wire-section-label">Account actions</div>
        <div className="border-y border-gray-100">
          <button type="button" onClick={() => onNavigate("settings-signout")} className="w-full text-left">
            <SettingRow
              label="Sign out"
              meta={signOut ? "Signing out..." : "Return to welcome flow"}
              trailing={<LogOut className="h-4 w-4 text-gray-400" />}
            />
          </button>
          <button type="button" onClick={() => onNavigate("settings-delete-account")} className="w-full text-left">
            <SettingRow
              label="Delete account"
              meta="Destructive confirmation required"
              warning
              trailing={<Trash2 className="h-4 w-4 text-gray-400" />}
            />
          </button>
        </div>
      </div>

      {deleteAccount ? (
        <div className="absolute inset-0 flex items-end bg-gray-900/15 px-4 pb-24">
          <div className="w-full rounded-[26px] bg-white p-5 shadow-lg">
            <div className="text-[15px] font-semibold text-gray-900">Delete account?</div>
            <div className="mt-2 text-[12px] leading-relaxed text-gray-500">
              This is a destructive flow and should stand apart visually from normal settings rows.
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => onNavigate("settings")} className="wire-button-secondary">
                Cancel
              </button>
              <button type="button" onClick={() => onNavigate("welcome-signin")} className="wire-button-primary">
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <WireBottomNav active="settings" onNavigate={onNavigate} />
    </div>
  );
}
