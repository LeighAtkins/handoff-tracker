import { formatAgo, formatDateTime } from "@/lib/format";

/**
 * When the worker last asked the carrier about a Leg. Staff trust "no news" only if they can see
 * that someone actually looked, so failures are shown rather than hidden.
 */
export function LastChecked({
  leg,
  now,
}: {
  leg?: { lastCheckedAt: Date | null; lastCheckError: string | null; carrierCode: string } | null;
  now?: Date;
}) {
  if (!leg?.lastCheckedAt) return <span className="text-zinc-400">not yet</span>;
  if (leg.lastCheckError) {
    return (
      <span
        className="text-red-700"
        title={`${formatDateTime(leg.lastCheckedAt)}: ${leg.lastCheckError}`}
      >
        failed {formatAgo(leg.lastCheckedAt, now)}
      </span>
    );
  }
  return (
    <span className="text-zinc-600" title={formatDateTime(leg.lastCheckedAt)}>
      {formatAgo(leg.lastCheckedAt, now)}
    </span>
  );
}
