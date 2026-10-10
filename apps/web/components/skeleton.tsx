/** Placeholder blocks shown while a page streams in. */
export function Skeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" className="animate-pulse">
      <span className="sr-only">{label}</span>
      <div className="h-7 w-56 rounded bg-zinc-200" />
      <div className="mt-3 h-4 w-80 rounded bg-zinc-200" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-9 rounded bg-zinc-100" />
        ))}
      </div>
    </div>
  );
}
