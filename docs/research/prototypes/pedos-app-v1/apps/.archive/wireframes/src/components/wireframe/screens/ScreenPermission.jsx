import { Mic, Settings, Shield, TriangleAlert } from "lucide-react";
import WireBottomNav from "../WireBottomNav";
import WireTopBar from "../WireTopBar";

export default function ScreenPermission({ variant = "education", onNavigate }) {
  const isPrompt = variant === "prompt";
  const isDenied = variant === "denied";

  return (
    <div className="relative flex h-full flex-col bg-white">
      <WireTopBar title="Microphone" showBack onBack={() => onNavigate("welcome-signin")} />

      <div className="flex-1 px-5 pb-8 pt-6">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-gray-100">
          <Mic className="h-8 w-8 text-gray-500" />
        </div>

        <div className="mt-6 text-center">
          <div className="text-[26px] font-bold leading-[1.05] text-gray-900">
            We need the mic only when you record.
          </div>
          <div className="mt-3 text-[13px] leading-relaxed text-gray-500">
            MVP is manual capture. No passive listening, no weird background spying.
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <div className="wire-card flex items-start gap-3 p-4">
            <Shield className="mt-0.5 h-4 w-4 text-gray-500" />
            <div className="text-[12px] leading-relaxed text-gray-500">
              Recordings are user-triggered and clearly visible in the UI.
            </div>
          </div>
          <div className="wire-card flex items-start gap-3 p-4">
            <Mic className="mt-0.5 h-4 w-4 text-gray-500" />
            <div className="text-[12px] leading-relaxed text-gray-500">
              Grant access once, then the home screen becomes a fast one-tap entry point.
            </div>
          </div>
        </div>

        {isDenied ? (
          <div className="mt-5 rounded-[18px] border border-gray-300 bg-gray-100 px-4 py-3">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-gray-500" />
              <div>
                <div className="text-[12px] font-semibold text-gray-800">Microphone access is off</div>
                <div className="mt-1 text-[12px] leading-relaxed text-gray-500">
                  Open iPhone Settings and allow microphone access to continue.
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-gray-200 px-5 pb-8 pt-4">
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => onNavigate(isDenied ? "home-no-permission" : "permission-prompt")}
            className="wire-button-primary w-full"
          >
            {isDenied ? "Try again" : "Allow microphone"}
          </button>
          {isDenied ? (
            <button
              type="button"
              onClick={() => onNavigate("settings")}
              className="wire-button-secondary w-full"
            >
              <Settings className="mr-2 h-4 w-4" />
              Open settings flow
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate("home-no-permission")}
              className="wire-button-secondary w-full"
            >
              Not now
            </button>
          )}
        </div>
      </div>

      <WireBottomNav active="home" onNavigate={onNavigate} />

      {isPrompt ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/15 px-8">
          <div className="w-full max-w-[280px] rounded-[26px] bg-white p-5 text-center shadow-lg">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <Mic className="h-5 w-5 text-gray-500" />
            </div>
            <div className="mt-3 text-[15px] font-semibold text-gray-900">
              "Pedos" Would Like to Access the Microphone
            </div>
            <div className="mt-2 text-[12px] leading-relaxed text-gray-500">
              This lets you manually record clips when you tap record.
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onNavigate("permission-denied")}
                className="wire-button-secondary"
              >
                Don&apos;t Allow
              </button>
              <button
                type="button"
                onClick={() => onNavigate("home")}
                className="wire-button-primary"
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
