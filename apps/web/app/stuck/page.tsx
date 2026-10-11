import type { Metadata } from "next";
import Link from "next/link";
import { loadBenchmarks, shipmentJourney } from "@handoff/app";
import { getPrisma, shipmentAggregateInclude } from "@handoff/db";
import { requireUser } from "@/lib/auth/session";
import { LastChecked } from "@/components/last-checked";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardHeader, CarrierChip, EmptyState, PageHeader, StatTile } from "@/components/ui";
import { AlertOctagon, Clock, Handoff } from "@/components/icons";
import { formatAgo } from "@/lib/format";
import { getAgo, getT } from "@/lib/i18n";
import { describeInsight } from "@/lib/insights";

export const metadata: Metadata = { title: "Stuck" };
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKETS = [
  { label: "3–4", min: 0, max: 4 },
  { label: "5–7", min: 5, max: 7 },
  { label: "8–14", min: 8, max: 14 },
  { label: "15+", min: 15, max: Infinity },
];

export default async function StuckPage() {
  await requireUser();
  const [t, ago] = await Promise.all([getT(), getAgo()]);
  const now = new Date();
  const prisma = getPrisma();
  const [stuck, benchmarks] = await Promise.all([
    prisma.shipment.findMany({
      where: { stuckSince: { not: null } },
      include: { ...shipmentAggregateInclude, order: true },
    }),
    loadBenchmarks(prisma, now),
  ]);

  const rows = stuck
    .map((shipment) => {
      const current = shipment.legs.at(-1)!;
      const quietFrom = shipment.lastEventAt ?? shipment.createdAt;
      const handoff = shipment.handoffs.find((h) => h.toLegId === current.id);
      const daysQuiet = Math.floor((now.getTime() - quietFrom.getTime()) / DAY_MS);
      const view = shipmentJourney(shipment, { benchmarks, now });
      const next = view.insights[0]
        ? describeInsight(view.insights[0], {
            t,
            trackingNumber: current.trackingNumber,
            quietDays: daysQuiet,
            lastMileCarrier: shipment.legs[1]?.carrierCode ?? null,
          })
        : null;
      return {
        shipment,
        current,
        daysQuiet,
        next,
        // Quiet since the handoff: the receiving carrier has not picked the parcel up.
        afterHandoff: Boolean(
          handoff && (!shipment.lastEventAt || shipment.lastEventAt <= handoff.detectedAt),
        ),
      };
    })
    .sort((a, b) => b.daysQuiet - a.daysQuiet);

  const carriers = [...new Set(rows.map((r) => r.current.carrierCode))].sort();
  const count = (carrier: string, bucket: (typeof BUCKETS)[number]) =>
    rows.filter(
      (r) =>
        r.current.carrierCode === carrier && r.daysQuiet >= bucket.min && r.daysQuiet <= bucket.max,
    ).length;

  return (
    <div className="space-y-6">
      <PageHeader title={t.stuck.title} description={t.stuck.rule} />

      {rows.length === 0 ? (
        <EmptyState>{t.stuck.none}</EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              label={t.stuck.count}
              icon={<AlertOctagon className="size-4 text-red-600" title={t.severity.critical} />}
              tone="critical"
              value={rows.length}
            />
            <StatTile
              label={t.stuck.afterHandoff}
              icon={<Handoff className="size-4 text-violet-600" />}
              value={rows.filter((r) => r.afterHandoff).length}
            />
            <StatTile
              label={t.stuck.longest}
              icon={<Clock className="size-4 text-zinc-400" />}
              value={t.stuck.days(String(rows[0]!.daysQuiet))}
            />
          </div>

          <Card>
            <CardHeader title={t.stuck.oldestFirst} />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">{t.common.order}</th>
                    <th className="px-3 py-2.5 font-medium">{t.common.status}</th>
                    <th className="px-3 py-2.5 font-medium">{t.stuck.waitingOn}</th>
                    <th className="px-3 py-2.5 font-medium">{t.stuck.daysQuiet}</th>
                    <th className="px-3 py-2.5 font-medium">{t.journey.whatNext}</th>
                    <th className="px-3 py-2.5 font-medium">{t.common.lastEvent}</th>
                    <th className="px-5 py-2.5 font-medium">{t.common.lastChecked}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map(({ shipment, current, daysQuiet, afterHandoff, next }) => (
                    <tr key={shipment.id} className="align-top hover:bg-zinc-50/70">
                      <td className="px-5 py-3 font-mono">
                        <Link
                          href={`/shipments/${shipment.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {shipment.order.sourceOrderNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={shipment.status} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <CarrierChip code={current.carrierCode} />
                          <span className="font-mono text-xs text-zinc-500">
                            {current.trackingNumber}
                          </span>
                        </span>
                        {afterHandoff && (
                          <span className="mt-1 block text-xs font-medium text-violet-800">
                            {t.stuck.sinceHandoff}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-semibold tabular-nums">{daysQuiet}</td>
                      <td className="max-w-80 px-3 py-3 text-zinc-700">{next?.action ?? "—"}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-zinc-600">
                        {formatAgo(shipment.lastEventAt, now, ago)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <LastChecked leg={current} now={now} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="max-w-2xl">
            <CardHeader title={t.stuck.matrix} />
            <table className="w-full text-sm" data-testid="stuck-matrix">
              <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">{t.stuck.carrier}</th>
                  {BUCKETS.map((b) => (
                    <th key={b.label} className="px-5 py-2.5 text-right font-medium">
                      {t.stuck.days(b.label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {carriers.map((carrier) => (
                  <tr key={carrier}>
                    <td className="px-5 py-2.5">
                      <CarrierChip code={carrier} />
                    </td>
                    {BUCKETS.map((b) => (
                      <td key={b.label} className="px-5 py-2.5 text-right tabular-nums">
                        {count(carrier, b) || <span className="text-zinc-300">0</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
