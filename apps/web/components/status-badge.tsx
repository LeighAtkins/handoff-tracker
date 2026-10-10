import type { Status } from "@handoff/domain";
import { getT } from "@/lib/i18n";

const STYLES: Record<Status, string> = {
  PENDING: "bg-zinc-100 text-zinc-700",
  SHIPPED: "bg-sky-50 text-sky-800",
  IN_TRANSIT: "bg-sky-100 text-sky-900",
  HANDED_OFF: "bg-violet-100 text-violet-900",
  OUT_FOR_DELIVERY: "bg-amber-100 text-amber-900",
  DELIVERED: "bg-emerald-100 text-emerald-900",
  EXCEPTION: "bg-red-100 text-red-900",
  RETURNED: "bg-zinc-200 text-zinc-800",
};

export async function StatusBadge({ status }: { status: Status }) {
  const t = await getT();
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {t.status[status]}
    </span>
  );
}

export async function StuckBadge() {
  const t = await getT();
  return (
    <span className="inline-block rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
      {t.stuckBadge}
    </span>
  );
}
