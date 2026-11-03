export function UnreachableRow({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl bg-muted/60">
      <li className="flex min-h-11 items-center justify-between gap-4 py-0 pl-4">
        <span className="text-muted-foreground">Can't reach {what} right now.</span>
        <button
          type="button"
          className="min-h-11 shrink-0 px-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          onClick={onRetry}
        >
          Retry
        </button>
      </li>
    </ul>
  )
}
