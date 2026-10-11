import type { Metadata } from "next";
import Link from "next/link";
import { journeyInputFromShipment } from "@handoff/app";
import { analyseJourney, isStatus, STATUSES } from "@handoff/domain";
import { requireUser } from "@/lib/auth/session";
import { getPrisma, shipmentAggregateInclude, type Prisma } from "@handoff/db";
import { CarrierChip, EmptyState, PageHeader, button, input } from "@/components/ui";
import { LastChecked } from "@/components/last-checked";
import { StatusBadge, StuckBadge } from "@/components/status-badge";
import { formatAgo } from "@/lib/format";
import { getAgo, getT } from "@/lib/i18n";

export const metadata: Metadata = { title: "Shipments" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; status?: string; stuck?: string }>;

export default async function ShipmentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const [t, ago] = await Promise.all([getT(), getAgo()]);
  const { q = "", status = "", stuck } = await searchParams;
  const query = q.trim();

  const where: Prisma.ShipmentWhereInput = {
    ...(isStatus(status) ? { status } : {}),
    ...(stuck === "1" ? { stuckSince: { not: null } } : {}),
    ...(query
      ? {
          OR: [
            { order: { sourceOrderNumber: { contains: query, mode: "insensitive" } } },
            { legs: { some: { trackingNumber: { contains: query, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const shipments = await getPrisma().shipment.findMany({
    where,
    include: { ...shipmentAggregateInclude, order: true },
    orderBy: [
      { stuckSince: { sort: "asc", nulls: "last" } },
      { lastEventAt: { sort: "desc", nulls: "last" } },
    ],
    take: 200,
  });

  const now = new Date();
  return (
    <>
      <PageHeader title={t.shipments.title} />

      <form className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-600">{t.shipments.search}</span>
          <input name="q" defaultValue={query} className={`${input} w-64`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-600">{t.common.status}</span>
          <select name="status" defaultValue={status} className={input}>
            <option value="">{t.shipments.any}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.status[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 py-1.5">
          <input type="checkbox" name="stuck" value="1" defaultChecked={stuck === "1"} />
          {t.shipments.stuckOnly}
        </label>
        <button className={button.primary}>{t.shipments.filter}</button>
        <Link href="/shipments" className={`${button.link} py-2`}>
          {t.shipments.clear}
        </Link>
      </form>

      <p className="mt-4 text-sm text-zinc-600">
        {shipments.length === 200 ? t.shipments.first200 : t.shipments.count(shipments.length)}
      </p>

      {shipments.length === 0 ? (
        <div className="mt-6">
          <EmptyState>{t.shipments.none}</EmptyState>
        </div>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500">
              <tr>
                <th className="p-2 pl-4 font-medium">{t.common.order}</th>
                <th className="p-2 font-medium">{t.common.status}</th>
                <th className="p-2 font-medium">{t.journey.nowWith}</th>
                <th className="p-2 font-medium">{t.shipments.legs}</th>
                <th className="p-2 font-medium">{t.shipments.currentTracking}</th>
                <th className="p-2 font-medium">{t.common.lastEvent}</th>
                <th className="p-2 font-medium">{t.common.lastChecked}</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((shipment) => {
                const current = shipment.legs.at(-1);
                const { position, finished } = analyseJourney(
                  journeyInputFromShipment(shipment),
                  now,
                );
                return (
                  <tr
                    key={shipment.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="p-2 pl-4 font-mono">
                      <Link
                        href={`/shipments/${shipment.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {shipment.order.sourceOrderNumber}
                      </Link>
                    </td>
                    <td className="space-x-1 p-2">
                      <StatusBadge status={shipment.status} />
                      {shipment.stuckSince && <StuckBadge />}
                    </td>
                    <td className="p-2 text-zinc-700">
                      {position && !finished ? t.milestones[position] : "—"}
                    </td>
                    <td className="p-2">
                      <span className="flex items-center gap-1">
                        {shipment.legs.map((leg, i) => (
                          <span key={leg.id} className="flex items-center gap-1">
                            {i > 0 && <span className="text-zinc-400">→</span>}
                            <CarrierChip code={leg.carrierCode} />
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-xs">{current?.trackingNumber}</td>
                    <td className="p-2 text-zinc-600">
                      {formatAgo(shipment.lastEventAt, undefined, ago)}
                    </td>
                    <td className="p-2">
                      <LastChecked leg={current} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
