import { formatAgo, formatDateTime } from "@/lib/format";
import { getAgo, getT } from "@/lib/i18n";

/**
 * When the worker last asked the carrier about a Leg. Staff trust "no news" only if they can see
 * that someone actually looked, so failures are shown rather than hidden.
 */
export async function LastChecked({
  leg,
  now,
}: {
  leg?: { lastCheckedAt: Date | null; lastCheckError: string | null; carrierCode: string } | null;
  now?: Date;
}) {
  const [t, ago] = await Promise.all([getT(), getAgo()]);
  if (!leg?.lastCheckedAt) return <span className="text-zinc-400">{t.common.notYet}</span>;
  if (leg.lastCheckError) {
    return (
      <span
        className="text-red-700"
        title={`${formatDateTime(leg.lastCheckedAt)}: ${leg.lastCheckError}`}
      >
        {t.common.failed} {formatAgo(leg.lastCheckedAt, now, ago)}
      </span>
    );
  }
  return (
    <span className="text-zinc-600" title={formatDateTime(leg.lastCheckedAt)}>
      {formatAgo(leg.lastCheckedAt, now, ago)}
    </span>
  );
}
