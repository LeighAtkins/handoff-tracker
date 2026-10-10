import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_ASSUMPTIONS, trialMetrics } from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Metrics" };
export const dynamic = "force-dynamic";

const PERIODS = [7, 14, 30];
const num = (value: string | undefined, fallback: number) =>
  value && Number.isFinite(Number(value)) ? Number(value) : fallback;

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireUser();
  const days = PERIODS.includes(Number((await searchParams).days))
    ? Number((await searchParams).days)
    : 14;
  const now = new Date();
  const assumptions = {
    manualCheckMinutes: num(
      process.env.METRICS_MANUAL_CHECK_MINUTES,
      DEFAULT_ASSUMPTIONS.manualCheckMinutes,
    ),
    appCheckMinutes: num(
      process.env.METRICS_APP_CHECK_MINUTES,
      DEFAULT_ASSUMPTIONS.appCheckMinutes,
    ),
  };
  const m = await trialMetrics(getPrisma(), {
    since: new Date(now.getTime() - days * 86_400_000),
    now,
    assumptions,
  });
  const events = Object.values(m.eventsIngested).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Trial metrics</h1>
        <nav className="flex gap-3 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/metrics?days=${p}`}
              className={p === days ? "font-semibold" : "text-zinc-600 underline"}
            >
              Last {p} days
            </Link>
          ))}
        </nav>
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        {formatDateTime(m.period.since)} to {formatDateTime(m.period.now)}. Counted from the audit
        log, so every number can be traced back to individual entries.
      </p>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="metrics">
        <Stat
          label="Shipments tracked"
          value={m.shipmentsTracked}
          note={`${m.openNow} open now, ${m.newShipments} added`}
        />
        <Stat
          label="Stuck shipments surfaced"
          value={m.stuckSurfaced}
          note={`${m.stuckResolvedByStaff} resolved by staff, ${m.stuckClearedOnTheirOwn} moved again on their own`}
        />
        <Stat
          label="Median time stuck"
          value={m.medianHoursStuck === null ? "—" : `${m.medianHoursStuck} h`}
          note="from flagged to cleared"
        />
        <Stat
          label="Estimated minutes saved"
          value={m.estimate.minutesSaved}
          note="see assumption below"
        />
        <Stat
          label="Carrier lookups automated"
          value={m.carrierChecks}
          note={`${events} new tracking events`}
        />
        <Stat
          label="Handoffs detected automatically"
          value={m.carrierHandoffs}
          note="Leg 2 created without anyone opening a carrier site"
        />
        <Stat label="Active users" value={m.activeUsers} note={`${m.staffActions} actions taken`} />
      </section>

      <section className="mt-8 max-w-2xl rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <h2 className="font-medium text-zinc-900">How &ldquo;minutes saved&rdquo; is estimated</h2>
        <p className="mt-2">
          Each stuck shipment surfaced is one check a person would otherwise have made by hand: open
          4PX, find the Sagawa number, open Sagawa. That is assumed to take{" "}
          <strong>{assumptions.manualCheckMinutes} minutes</strong>, against{" "}
          <strong>{assumptions.appCheckMinutes} minutes</strong> here. Replace both with timings
          measured during the trial (<code>METRICS_MANUAL_CHECK_MINUTES</code>,{" "}
          <code>METRICS_APP_CHECK_MINUTES</code>). Only report what was measured.
        </p>
      </section>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{note}</p>
    </div>
  );
}
