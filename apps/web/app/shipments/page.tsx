import type { Metadata } from "next";
import Link from "next/link";
import { isStatus, STATUSES } from "@handoff/domain";
import { getPrisma, type Prisma } from "@handoff/db";
import { StatusBadge, StuckBadge } from "@/components/status-badge";
import { formatAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Shipments" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; status?: string; stuck?: string }>;

export default async function ShipmentsPage({ searchParams }: { searchParams: SearchParams }) {
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
    include: { order: true, legs: { orderBy: { sequence: "asc" } } },
    orderBy: [
      { stuckSince: { sort: "asc", nulls: "last" } },
      { lastEventAt: { sort: "desc", nulls: "last" } },
    ],
    take: 200,
  });

  return (
    <>
      <h1 className="text-2xl font-semibold">Shipments</h1>

      <form className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-600">Order or tracking number</span>
          <input
            name="q"
            defaultValue={query}
            className="w-64 rounded border border-zinc-300 bg-white px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-600">Status</span>
          <select
            name="status"
            defaultValue={status}
            className="rounded border border-zinc-300 bg-white px-2 py-1.5"
          >
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 py-1.5">
          <input type="checkbox" name="stuck" value="1" defaultChecked={stuck === "1"} />
          Stuck only
        </label>
        <button className="rounded bg-zinc-900 px-3 py-1.5 text-white">Filter</button>
        <Link href="/shipments" className="py-1.5 text-zinc-600 underline">
          Clear
        </Link>
      </form>

      <p className="mt-4 text-sm text-zinc-600">
        {shipments.length === 200
          ? "Showing the first 200 matches"
          : `${shipments.length} shipments`}
      </p>

      {shipments.length === 0 ? (
        <p className="mt-6 rounded border border-dashed border-zinc-300 bg-white p-8 text-center text-zinc-600">
          No shipments match these filters.
        </p>
      ) : (
        <table className="mt-2 w-full border-collapse bg-white text-left text-sm shadow-sm">
          <thead className="border-b border-zinc-200 text-zinc-500">
            <tr>
              <th className="p-2 font-medium">Order</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2 font-medium">Legs</th>
              <th className="p-2 font-medium">Current tracking number</th>
              <th className="p-2 font-medium">Last event</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((shipment) => {
              const current = shipment.legs.at(-1);
              return (
                <tr key={shipment.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="p-2 font-mono">
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
                  <td className="p-2">{shipment.legs.map((leg) => leg.carrierCode).join(" → ")}</td>
                  <td className="p-2 font-mono text-xs">{current?.trackingNumber}</td>
                  <td className="p-2 text-zinc-600">{formatAgo(shipment.lastEventAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
