export default function IPhoneFrame({ children, label }) {
  return (
    <div className="flex flex-shrink-0 flex-col items-center gap-3">
      {label ? (
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {label}
        </div>
      ) : null}

      <div
        data-testid="iphone-frame"
        className="relative rounded-[44px] bg-black p-[12px] shadow-xl"
        style={{ width: 417, height: 876 }}
      >
        <div className="absolute left-1/2 top-[18px] z-30 h-[36px] w-[126px] -translate-x-1/2 rounded-full bg-black" />

        <div
          data-testid="iphone-screen"
          className="relative overflow-hidden rounded-[34px] bg-white"
          style={{ width: 393, height: 852 }}
        >
          <div className="absolute left-0 right-0 top-0 z-20 flex h-[54px] items-end justify-between px-8 pb-1">
            <span className="text-[12px] font-semibold text-gray-800">9:41</span>
            <div className="flex items-center gap-1">
              <div className="flex h-[10px] w-[17px] items-center justify-end rounded-sm border border-gray-800 pr-[1px]">
                <div className="h-[6px] w-[10px] rounded-[1px] bg-gray-800" />
              </div>
            </div>
          </div>

          <div className="absolute inset-0 pt-[54px]">{children}</div>

          <div className="absolute bottom-2 left-1/2 z-20 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-gray-900" />
        </div>
      </div>
    </div>
  );
}
