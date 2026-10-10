import type { Metadata } from "next";
import Link from "next/link";
import { getPrisma } from "@handoff/db";
import { StatusBadge } from "@/components/status-badge";
import { formatAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Stuck" };
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKETS = [
  { label: "3–4 days", min: 0, max: 4 },
  { label: "5–7 days", min: 5, max: 7 },
  { label: "8–14 days", min: 8, max: 14 },
  { label: "15+ days", min: 15, max: Infinity },
];

export default async function StuckPage() {
  const now = new Date();
  const stuck = await getPrisma().shipment.findMany({
    where: { stuckSince: { not: null } },
    include: { order: true, legs: { orderBy: { sequence: "asc" } }, handoffs: true },
  });

  const rows = stuck
    .map((shipment) => {
      const current = shipment.legs.at(-1)!;
      const quietFrom = shipment.lastEventAt ?? shipment.createdAt;
      const handoff = shipment.handoffs.find((h) => h.toLegId === current.id);
      return {
        shipment,
        current,
        daysQuiet: Math.floor((now.getTime() - quietFrom.getTime()) / DAY_MS),
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
    <>
      <h1 className="text-2xl font-semibold">Stuck shipments</h1>
      <p className="mt-1 text-sm text-zinc-600">
        No new tracking event for 3 days, or 5 days straight after a handoff.
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded border border-dashed border-zinc-300 bg-white p-8 text-center text-zinc-600">
          Nothing is stuck. Every open shipment has moved recently.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Stat label="Stuck" value={rows.length} />
            <Stat label="Quiet after a handoff" value={rows.filter((r) => r.afterHandoff).length} />
            <Stat label="Longest quiet" value={`${rows[0]!.daysQuiet}d`} />
          </div>

          <h2 className="mt-8 font-medium">By current carrier and days quiet</h2>
          <table className="mt-2 bg-white text-sm shadow-sm" data-testid="stuck-matrix">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="p-2 text-left font-medium">Carrier</th>
                {BUCKETS.map((b) => (
                  <th key={b.label} className="p-2 text-right font-medium">
                    {b.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carriers.map((carrier) => (
                <tr key={carrier} className="border-b border-zinc-100">
                  <td className="p-2">{carrier}</td>
                  {BUCKETS.map((b) => (
                    <td key={b.label} className="p-2 text-right tabular-nums">
                      {count(carrier, b) || <span className="text-zinc-300">0</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-8 font-medium">Oldest first</h2>
          <table className="mt-2 w-full bg-white text-left text-sm shadow-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="p-2 font-medium">Order</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium">Waiting on</th>
                <th className="p-2 font-medium">Days quiet</th>
                <th className="p-2 font-medium">Last event</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ shipment, current, daysQuiet, afterHandoff }) => (
                <tr key={shipment.id} className="border-b border-zinc-100">
                  <td className="p-2 font-mono">
                    <Link
                      href={`/shipments/${shipment.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {shipment.order.sourceOrderNumber}
                    </Link>
                  </td>
                  <td className="p-2">
                    <StatusBadge status={shipment.status} />
                  </td>
                  <td className="p-2">
                    {current.carrierCode}{" "}
                    <span className="font-mono text-xs text-zinc-500">
                      {current.trackingNumber}
                    </span>
                    {afterHandoff && (
                      <span className="ml-2 text-xs text-violet-800">since handoff</span>
                    )}
                  </td>
                  <td className="p-2 tabular-nums">{daysQuiet}</td>
                  <td className="p-2 text-zinc-600">{formatAgo(shipment.lastEventAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
