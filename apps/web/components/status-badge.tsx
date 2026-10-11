import type { Status } from "@handoff/domain";
import { getT } from "@/lib/i18n";

const STYLES: Record<Status, { pill: string; dot: string }> = {
  PENDING: { pill: "bg-zinc-100 text-zinc-700 ring-zinc-200", dot: "bg-zinc-400" },
  SHIPPED: { pill: "bg-sky-50 text-sky-800 ring-sky-200", dot: "bg-sky-400" },
  IN_TRANSIT: { pill: "bg-sky-50 text-sky-900 ring-sky-200", dot: "bg-sky-600" },
  HANDED_OFF: { pill: "bg-violet-50 text-violet-900 ring-violet-200", dot: "bg-violet-600" },
  OUT_FOR_DELIVERY: { pill: "bg-amber-50 text-amber-900 ring-amber-200", dot: "bg-amber-500" },
  DELIVERED: { pill: "bg-emerald-50 text-emerald-900 ring-emerald-200", dot: "bg-emerald-600" },
  EXCEPTION: { pill: "bg-red-50 text-red-900 ring-red-200", dot: "bg-red-600" },
  RETURNED: { pill: "bg-zinc-100 text-zinc-800 ring-zinc-300", dot: "bg-zinc-600" },
};

export async function StatusBadge({ status }: { status: Status }) {
  const t = await getT();
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap ring-1 ring-inset ${style.pill}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${style.dot}`} />
      {t.status[status]}
    </span>
  );
}

export async function StuckBadge() {
  const t = await getT();
  return (
    <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white">
      {t.stuckBadge}
    </span>
  );
}
