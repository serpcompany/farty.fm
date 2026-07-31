import { Bell, ChevronLeft, User } from "lucide-react";

function TopIcon({ children }) {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
      {children}
    </div>
  );
}

export default function WireTopBar({
  title,
  showProfile = false,
  showNotif = false,
  showBack = false,
  onBack,
  rightAction = null,
}) {
  return (
    <div className="flex h-[48px] items-center justify-between border-b border-gray-200 bg-white px-4">
      <div className="flex items-center gap-2">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100"
          >
            <ChevronLeft className="h-4 w-4 text-gray-500" />
          </button>
        ) : null}
        <span className="text-[16px] font-semibold text-gray-900">{title}</span>
      </div>

      <div className="flex items-center gap-3">
        {rightAction}
        {showNotif ? (
          <TopIcon>
            <Bell className="h-4 w-4 text-gray-500" />
          </TopIcon>
        ) : null}
        {showProfile ? (
          <TopIcon>
            <User className="h-4 w-4 text-gray-500" />
          </TopIcon>
        ) : null}
      </div>
    </div>
  );
}
