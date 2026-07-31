import { useMemo, useState } from "react";
import IPhoneFrame from "../components/wireframe/IPhoneFrame";
import ScreenDetail from "../components/wireframe/screens/ScreenDetail";
import ScreenHistory from "../components/wireframe/screens/ScreenHistory";
import ScreenHome from "../components/wireframe/screens/ScreenHome";
import ScreenPedosAI from "../components/wireframe/screens/ScreenPedosAI";
import ScreenPermission from "../components/wireframe/screens/ScreenPermission";
import ScreenQuickRecord from "../components/wireframe/screens/ScreenQuickRecord";
import ScreenRecording from "../components/wireframe/screens/ScreenRecording";
import ScreenReview from "../components/wireframe/screens/ScreenReview";
import ScreenSettings from "../components/wireframe/screens/ScreenSettings";
import ScreenStats from "../components/wireframe/screens/ScreenStats";
import ScreenWelcome from "../components/wireframe/screens/ScreenWelcome";

const screens = [
  { id: "welcome-signin", label: "1. Welcome / Sign In", group: "Entry" },
  { id: "welcome-create", label: "2. Create Account", group: "Entry" },
  { id: "welcome-error", label: "3. Sign-In Error", group: "Entry" },
  { id: "permission-education", label: "4. Mic Permission Education", group: "Permissions" },
  { id: "permission-prompt", label: "5. Mic Permission Prompt", group: "Permissions" },
  { id: "permission-denied", label: "6. Mic Permission Denied", group: "Permissions" },
  { id: "quick-record-trigger", label: "7. Siri / App Shortcut Trigger", group: "Quick Record" },
  { id: "quick-record-fallback", label: "8. Quick Record Permission Fallback", group: "Quick Record" },
  { id: "quick-record-active", label: "9. Quick Record Active Recording", group: "Quick Record" },
  { id: "home", label: "10. Home", group: "Home" },
  { id: "home-empty", label: "11. Home Empty State", group: "Home" },
  { id: "home-no-permission", label: "12. Home With Permission Missing", group: "Home" },
  { id: "recording", label: "13. Recording", group: "Recording Flow" },
  { id: "recording-canceled", label: "14. Recording Canceled", group: "Recording Flow" },
  { id: "recording-failed", label: "15. Recording Failed", group: "Recording Flow" },
  { id: "review", label: "16. Review Before Save", group: "Recording Flow" },
  { id: "review-saving", label: "17. Save In Progress", group: "Recording Flow" },
  { id: "review-failed", label: "18. Save Failed", group: "Recording Flow" },
  { id: "history", label: "19. History", group: "History" },
  { id: "history-empty", label: "20. History Empty State", group: "History" },
  { id: "history-loading", label: "21. History Loading", group: "History" },
  { id: "history-delete-confirm", label: "22. Delete Confirmation", group: "History" },
  { id: "detail", label: "23. Recording Detail / Playback", group: "History" },
  { id: "detail-playback-failed", label: "24. Playback Failed", group: "History" },
  { id: "stats", label: "25. Stats", group: "Stats" },
  { id: "stats-empty", label: "26. Stats Empty State", group: "Stats" },
  { id: "settings", label: "27. Settings / Profile", group: "Settings" },
  { id: "settings-signout", label: "28. Sign Out In Progress", group: "Settings" },
  { id: "settings-delete-account", label: "29. Delete Account", group: "Settings" },
  { id: "pedos-ai-home", label: "30. Pedos AI Home", group: "Pedos AI" },
  { id: "pedos-ai-clip-source", label: "31. Clip Source Selection", group: "Pedos AI" },
  { id: "pedos-ai-smart-choose", label: "32. AI Smart Choose Review", group: "Pedos AI" },
  { id: "pedos-ai-song-type", label: "33. Song Type Selection", group: "Pedos AI" },
  { id: "pedos-ai-original-prompt", label: "34. Original Song Prompt", group: "Pedos AI" },
  { id: "pedos-ai-cover-input", label: "35. Cover Song Input", group: "Pedos AI" },
  { id: "pedos-ai-generating", label: "36. Generation In Progress", group: "Pedos AI" },
  { id: "pedos-ai-failed", label: "37. Generation Failed", group: "Pedos AI" },
  { id: "pedos-ai-result", label: "38. Generated Song Result", group: "Pedos AI" },
];

const notesByScreen = {
  "welcome-signin": "Entry screen for auth-required MVP.",
  "welcome-create": "Create account variant if guest mode does not win.",
  "welcome-error": "Sign-in failure state should be visible and recoverable.",
  "permission-education": "Pre-permission trust-building screen.",
  "permission-prompt": "System prompt representation in the wireframe flow.",
  "permission-denied": "Shows the denied path and route to settings.",
  "quick-record-trigger": "Siri and App Shortcut concept for the fastest iPhone-safe record flow.",
  "quick-record-fallback": "Permission fallback path when shortcut entry happens before mic approval.",
  "quick-record-active": "Successful shortcut-triggered recording state.",
  home: "Primary record CTA should dominate this screen.",
  "home-empty": "First-use empty state without dead air.",
  "home-no-permission": "Home needs a safe path when recording is blocked.",
  recording: "Live recording state with timer and obvious stop action.",
  "recording-canceled": "Canceled flow should exit cleanly.",
  "recording-failed": "Failure path should prompt retry, not confusion.",
  review: "Review and save the captured clip.",
  "review-saving": "Saving should keep the clip visible instead of hiding state.",
  "review-failed": "Failed save should not lose work.",
  history: "Chronological clip library.",
  "history-empty": "History empty state should push toward first recording.",
  "history-loading": "Light skeleton state for library load.",
  "history-delete-confirm": "Destructive action should confirm.",
  detail: "Single clip management and playback view.",
  "detail-playback-failed": "Playback errors need explicit messaging.",
  stats: "Simple payoff, not overbuilt analytics.",
  "stats-empty": "Stats empty state for very early users.",
  settings: "Account, privacy, and app status.",
  "settings-signout": "Progress state for sign out action.",
  "settings-delete-account": "Delete flow needs strong separation from normal actions.",
  "pedos-ai-home": "Feature entry point for song generation from saved clips.",
  "pedos-ai-clip-source": "All clips, manual choose, or AI smart choose.",
  "pedos-ai-smart-choose": "Review step after AI picks source clips.",
  "pedos-ai-song-type": "Original and cover-style options branch from the same source selection step.",
  "pedos-ai-original-prompt": "Lightweight creative controls for original generation.",
  "pedos-ai-cover-input": "Artist/song input for cover-style generation.",
  "pedos-ai-generating": "Async job state for song generation.",
  "pedos-ai-failed": "Recovery state if generation fails.",
  "pedos-ai-result": "Playback and source summary for the generated song.",
};

function renderScreen(screenId, onNavigate) {
  switch (screenId) {
    case "welcome-signin":
      return <ScreenWelcome variant="signin" onNavigate={onNavigate} />;
    case "welcome-create":
      return <ScreenWelcome variant="create" onNavigate={onNavigate} />;
    case "welcome-error":
      return <ScreenWelcome variant="error" onNavigate={onNavigate} />;
    case "permission-education":
      return <ScreenPermission variant="education" onNavigate={onNavigate} />;
    case "permission-prompt":
      return <ScreenPermission variant="prompt" onNavigate={onNavigate} />;
    case "permission-denied":
      return <ScreenPermission variant="denied" onNavigate={onNavigate} />;
    case "quick-record-trigger":
      return <ScreenQuickRecord variant="trigger" onNavigate={onNavigate} />;
    case "quick-record-fallback":
      return <ScreenQuickRecord variant="fallback" onNavigate={onNavigate} />;
    case "quick-record-active":
      return <ScreenQuickRecord variant="active" onNavigate={onNavigate} />;
    case "home":
      return <ScreenHome variant="default" onNavigate={onNavigate} />;
    case "home-empty":
      return <ScreenHome variant="empty" onNavigate={onNavigate} />;
    case "home-no-permission":
      return <ScreenHome variant="no-permission" onNavigate={onNavigate} />;
    case "recording":
      return <ScreenRecording variant="active" onNavigate={onNavigate} />;
    case "recording-canceled":
      return <ScreenRecording variant="canceled" onNavigate={onNavigate} />;
    case "recording-failed":
      return <ScreenRecording variant="failed" onNavigate={onNavigate} />;
    case "review":
      return <ScreenReview variant="default" onNavigate={onNavigate} />;
    case "review-saving":
      return <ScreenReview variant="saving" onNavigate={onNavigate} />;
    case "review-failed":
      return <ScreenReview variant="failed" onNavigate={onNavigate} />;
    case "history":
      return <ScreenHistory variant="default" onNavigate={onNavigate} />;
    case "history-empty":
      return <ScreenHistory variant="empty" onNavigate={onNavigate} />;
    case "history-loading":
      return <ScreenHistory variant="loading" onNavigate={onNavigate} />;
    case "history-delete-confirm":
      return <ScreenHistory variant="delete-confirm" onNavigate={onNavigate} />;
    case "detail":
      return <ScreenDetail variant="default" onNavigate={onNavigate} />;
    case "detail-playback-failed":
      return <ScreenDetail variant="failed" onNavigate={onNavigate} />;
    case "stats":
      return <ScreenStats variant="default" onNavigate={onNavigate} />;
    case "stats-empty":
      return <ScreenStats variant="empty" onNavigate={onNavigate} />;
    case "settings":
      return <ScreenSettings variant="default" onNavigate={onNavigate} />;
    case "settings-signout":
      return <ScreenSettings variant="signout" onNavigate={onNavigate} />;
    case "settings-delete-account":
      return <ScreenSettings variant="delete-account" onNavigate={onNavigate} />;
    case "pedos-ai-home":
      return <ScreenPedosAI variant="home" onNavigate={onNavigate} />;
    case "pedos-ai-clip-source":
      return <ScreenPedosAI variant="clip-source" onNavigate={onNavigate} />;
    case "pedos-ai-smart-choose":
      return <ScreenPedosAI variant="smart-choose" onNavigate={onNavigate} />;
    case "pedos-ai-song-type":
      return <ScreenPedosAI variant="song-type" onNavigate={onNavigate} />;
    case "pedos-ai-original-prompt":
      return <ScreenPedosAI variant="original-prompt" onNavigate={onNavigate} />;
    case "pedos-ai-cover-input":
      return <ScreenPedosAI variant="cover-input" onNavigate={onNavigate} />;
    case "pedos-ai-generating":
      return <ScreenPedosAI variant="generating" onNavigate={onNavigate} />;
    case "pedos-ai-failed":
      return <ScreenPedosAI variant="failed" onNavigate={onNavigate} />;
    case "pedos-ai-result":
      return <ScreenPedosAI variant="result" onNavigate={onNavigate} />;
    default:
      return <ScreenWelcome variant="signin" onNavigate={onNavigate} />;
  }
}

export default function Wireframes() {
  const [activeScreen, setActiveScreen] = useState("welcome-signin");
  const [viewMode, setViewMode] = useState("interactive");

  const groupedScreens = useMemo(() => {
    return screens.reduce((accumulator, screen) => {
      if (!accumulator[screen.group]) {
        accumulator[screen.group] = [];
      }
      accumulator[screen.group].push(screen);
      return accumulator;
    }, {});
  }, []);

  const current = screens.find((screen) => screen.id === activeScreen);
  const navigate = (screenId) => setActiveScreen(screenId);

  return (
    <div className="min-h-screen bg-gray-100 font-inter">
      <div className="sticky top-0 z-50 border-b border-gray-200 bg-white/85 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between gap-6">
            <div>
              <h1 className="text-[20px] font-bold text-gray-900">Pedos Wireframes</h1>
              <p className="mt-0.5 text-[13px] text-gray-400">
                Low-fidelity iPhone wireframe set based on the base44 reference pattern
              </p>
            </div>

            <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
              {[
                { id: "interactive", label: "Interactive" },
                { id: "gallery", label: "Gallery" },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setViewMode(mode.id)}
                  className={
                    viewMode === mode.id
                      ? "rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-gray-900 shadow-sm"
                      : "rounded-md px-3 py-1.5 text-[12px] font-medium text-gray-500"
                  }
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {viewMode === "interactive" ? (
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="flex flex-col gap-8 lg:flex-row">
            <div className="lg:w-[250px] lg:flex-shrink-0">
              <div
                data-testid="screen-nav"
                className="sticky top-[84px] max-h-[calc(100vh-108px)] space-y-4 overflow-y-auto pr-2"
              >
                {Object.entries(groupedScreens).map(([group, entries]) => (
                  <div key={group}>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      {group}
                    </div>
                    <div className="space-y-1">
                      {entries.map((screen) => (
                        <button
                          key={screen.id}
                          type="button"
                          onClick={() => navigate(screen.id)}
                          className={
                            activeScreen === screen.id
                              ? "w-full rounded-lg bg-gray-900 px-3 py-2 text-left text-[13px] font-semibold text-white"
                              : "w-full rounded-lg px-3 py-2 text-left text-[13px] text-gray-600 hover:bg-gray-200"
                          }
                        >
                          {screen.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-1 justify-center">
              <IPhoneFrame label={current?.label}>
                {renderScreen(activeScreen, navigate)}
              </IPhoneFrame>
            </div>

            <div className="lg:w-[240px] lg:flex-shrink-0">
              <div className="sticky top-[84px] rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Screen info
                </div>
                <div className="mt-4">
                  <div className="text-[11px] text-gray-400">Current</div>
                  <div className="text-[14px] font-semibold text-gray-900">{current?.label}</div>
                </div>
                <div className="mt-4">
                  <div className="text-[11px] text-gray-400">Group</div>
                  <div className="text-[13px] text-gray-600">{current?.group}</div>
                </div>
                <div className="mt-4">
                  <div className="text-[11px] text-gray-400">Notes</div>
                  <div className="text-[12px] leading-relaxed text-gray-500">
                    {notesByScreen[activeScreen]}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-6 py-8">
          <div className="flex gap-8 overflow-x-auto pb-8" style={{ scrollSnapType: "x mandatory" }}>
            {screens.map((screen) => (
              <div key={screen.id} style={{ scrollSnapAlign: "start" }}>
                <IPhoneFrame label={screen.label}>
                  {renderScreen(screen.id, () => {})}
                </IPhoneFrame>
              </div>
            ))}
          </div>
          <div className="text-center text-[12px] text-gray-400">
            Scroll horizontally to review the full flow and state set.
          </div>
        </div>
      )}
    </div>
  );
}
