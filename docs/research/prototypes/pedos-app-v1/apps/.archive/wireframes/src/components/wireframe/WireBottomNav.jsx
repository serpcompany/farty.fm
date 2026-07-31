import { BarChart3, Clock3, Home, Music4, Settings } from "lucide-react";

const tabs = [
  { id: "home", label: "Home", icon: Home, screenId: "home" },
  { id: "history", label: "History", icon: Clock3, screenId: "history" },
  { id: "pedos-ai", label: "AI Song Creator", icon: Music4, screenId: "pedos-ai-home" },
  { id: "stats", label: "Stats", icon: BarChart3, screenId: "stats" },
  { id: "settings", label: "Settings", icon: Settings, screenId: "settings" },
];

export default function WireBottomNav({ active, onNavigate }) {
  return (
    <div
      data-testid="bottom-nav"
      className="z-10 flex h-[92px] items-start border-t border-gray-200 bg-gray-50 px-1 pt-2"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;

        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            onClick={() => onNavigate(tab.screenId)}
            className="flex flex-1 flex-col items-center gap-1 px-1 py-1"
          >
            <Icon
              className={isActive ? "h-5 w-5 text-gray-900" : "h-5 w-5 text-gray-400"}
              strokeWidth={isActive ? 2.5 : 1.75}
            />
            <span
              className={
                isActive
                  ? "text-center text-[9px] font-semibold leading-[1.1] text-gray-900"
                  : "text-center text-[9px] leading-[1.1] text-gray-400"
              }
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
