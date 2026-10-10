import { STATUSES, type Status } from "@handoff/domain";
import { getPrisma } from "@handoff/db";

// Reads live data on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function ShipmentsPage() {
  const prisma = getPrisma();
  const shipments = await prisma.shipment.findMany({
    include: { order: true, legs: { orderBy: { sequence: "asc" } } },
    orderBy: [{ stuckSince: { sort: "asc", nulls: "last" } }, { lastEventAt: "desc" }],
  });

  const counts = new Map<Status, number>(STATUSES.map((s) => [s, 0]));
  for (const shipment of shipments)
    counts.set(shipment.status, (counts.get(shipment.status) ?? 0) + 1);
  const stuck = shipments.filter((s) => s.stuckSince).length;
  const now = Date.now();

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold">Shipments</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {shipments.length} shipments ·{" "}
        <span className="font-medium text-red-700">{stuck} stuck</span>
      </p>

      <ul className="mt-6 flex flex-wrap gap-2 text-sm">
        {STATUSES.map((status) => (
          <li key={status} className="rounded border border-zinc-200 bg-white px-3 py-1">
            {status} <span className="font-semibold">{counts.get(status)}</span>
          </li>
        ))}
      </ul>

      <table className="mt-6 w-full border-collapse bg-white text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="p-2 font-medium">Order</th>
            <th className="p-2 font-medium">Status</th>
            <th className="p-2 font-medium">Legs</th>
            <th className="p-2 font-medium">Last event</th>
          </tr>
        </thead>
        <tbody>
          {shipments.map((shipment) => (
            <tr key={shipment.id} className="border-b border-zinc-100">
              <td className="p-2 font-mono">{shipment.order.sourceOrderNumber}</td>
              <td className="p-2">
                {shipment.status}
                {shipment.stuckSince && (
                  <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                    stuck
                  </span>
                )}
              </td>
              <td className="p-2">{shipment.legs.map((leg) => leg.carrierCode).join(" → ")}</td>
              <td className="p-2 text-zinc-600">
                {shipment.lastEventAt
                  ? `${Math.floor((now - shipment.lastEventAt.getTime()) / DAY)}d ago`
                  : "never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
