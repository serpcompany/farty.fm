import { ArrowRight, CircleDot, Sparkles } from "lucide-react";
import WireBottomNav from "../WireBottomNav";

function CTAButton({ label, primary = false, onClick }) {
  const className = primary ? "wire-button-primary" : "wire-button-secondary";

  return (
    <button type="button" onClick={onClick} className={className}>
      {label}
    </button>
  );
}

export default function ScreenWelcome({ variant = "signin", onNavigate }) {
  const isCreate = variant === "create";
  const isError = variant === "error";

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 px-6 pb-8 pt-8">
        <div className="flex items-center justify-between">
          <span className="wire-chip">iPhone MVP</span>
          <span className="wire-chip">Low-fi wireframe</span>
        </div>

        <div className="mt-8 wire-card bg-gradient-to-b from-gray-50 to-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-gray-900">
              <CircleDot className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Pedos
              </div>
              <div className="text-[18px] font-bold text-gray-900">
                Track every toot like it matters.
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-[18px] border border-gray-200 bg-white p-4">
              <div className="h-2 w-14 rounded-full bg-gray-200" />
              <div className="mt-3 h-16 rounded-[14px] bg-gray-100" />
            </div>
            <div className="rounded-[18px] border border-gray-200 bg-white p-4">
              <div className="h-2 w-10 rounded-full bg-gray-200" />
              <div className="mt-3 flex h-16 items-end gap-1">
                {[26, 38, 22, 50, 34].map((height) => (
                  <div
                    key={height}
                    className="w-full rounded-t-full bg-gray-300"
                    style={{ height }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-400">
            {isCreate ? "Create account" : "Welcome back"}
          </div>
          <div className="mt-2 text-[28px] font-bold leading-[1.05] text-gray-900">
            {isCreate ? "Make a home for your fart archive." : "Save clips. Replay history. Count the legends."}
          </div>
          <div className="mt-3 text-[13px] leading-relaxed text-gray-500">
            Fast manual capture first. Weird science later.
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <div className="wire-field">{isCreate ? "Email" : "Email or Apple sign-in"}</div>
          <div className="wire-field">{isCreate ? "Create password" : "Password"}</div>
          {isCreate ? <div className="wire-field">Display name</div> : null}
        </div>

        {isError ? (
          <div className="mt-4 rounded-[18px] border border-gray-300 bg-gray-100 px-4 py-3 text-[12px] text-gray-700">
            We could not sign you in. Check your connection and try again.
          </div>
        ) : null}

        <div className="mt-6 rounded-[18px] border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 text-gray-500" />
            <div className="text-[12px] leading-relaxed text-gray-500">
              Account flow is still open. If guest mode wins, this entry sequence can shrink later.
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 px-6 pb-8 pt-4">
        <div className="space-y-3">
          <CTAButton
            primary
            label={isCreate ? "Create account" : "Sign in"}
            onClick={() => onNavigate("permission-education")}
          />
          <CTAButton
            label={isCreate ? "Back to sign in" : "Create account"}
            onClick={() => onNavigate(isCreate ? "welcome-signin" : "welcome-create")}
          />
        </div>
        <button
          type="button"
          onClick={() => onNavigate("permission-education")}
          className="mt-4 flex items-center gap-2 text-[12px] font-medium text-gray-500"
        >
          Skip ahead in wireframe flow
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <WireBottomNav active="home" onNavigate={onNavigate} />
    </div>
  );
}
