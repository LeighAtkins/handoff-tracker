import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { daysQuiet } from "@handoff/domain";
import { requireUser } from "@/lib/auth/session";
import { getPrisma, shipmentAggregateInclude, toShipmentState } from "@handoff/db";
import { StatusBadge, StuckBadge } from "@/components/status-badge";
import { Timeline } from "@/components/timeline";
import { formatDateTime } from "@/lib/format";
import { hasRole } from "@handoff/app";
import { ActionsPanel } from "./actions-panel";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ tab?: string }>;

async function load(id: string) {
  return getPrisma().shipment.findUnique({
    where: { id },
    include: { ...shipmentAggregateInclude, order: true },
  });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const shipment = await load((await params).id);
  return { title: shipment?.order.sourceOrderNumber ?? "Shipment not found" };
}

export default async function ShipmentPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { tab } = await searchParams;
  const shipment = await load(id);
  if (!shipment) notFound();

  const state = toShipmentState(shipment);
  const quiet = daysQuiet(state, new Date());
  const prisma = getPrisma();
  const [audit, carriers] = await Promise.all([
    prisma.auditEntry.findMany({
      where: {
        OR: [
          { entityType: "Shipment", entityId: id },
          { entityType: "Order", entityId: shipment.orderId },
        ],
      },
      orderBy: { at: "desc" },
    }),
    prisma.carrier.findMany({ where: { enabled: true }, orderBy: { name: "asc" } }),
  ]);
  const notes = audit.filter((entry) => entry.action === "NOTE_ADDED");

  return (
    <>
      <p className="text-sm">
        <Link href="/shipments" className="text-zinc-600 underline">
          ← Shipments
        </Link>
      </p>
      <header className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold">{shipment.order.sourceOrderNumber}</h1>
        <StatusBadge status={shipment.status} />
        {shipment.stuckSince && <StuckBadge />}
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500">Customer</dt>
          <dd>{shipment.order.customerName}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Destination</dt>
          <dd>
            {shipment.order.destinationCountry} {shipment.order.destinationPostcode}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Last event</dt>
          <dd>
            {formatDateTime(shipment.lastEventAt)} ({quiet}d quiet)
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Stuck since</dt>
          <dd>{formatDateTime(shipment.stuckSince)}</dd>
        </div>
      </dl>

      {shipment.overrideStatus && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Status manually set to <strong>{shipment.overrideStatus.replaceAll("_", " ")}</strong> by{" "}
          {shipment.overrideBy} on {formatDateTime(shipment.overrideAt)}: “{shipment.overrideReason}
          ”
        </p>
      )}

      <nav className="mt-6 flex gap-4 border-b border-zinc-200 text-sm">
        {[
          { key: "timeline", label: "Timeline" },
          { key: "audit", label: "Audit" },
        ].map((t) => {
          const active = (tab ?? "timeline") === t.key;
          return (
            <Link
              key={t.key}
              href={t.key === "timeline" ? `/shipments/${id}` : `/shipments/${id}?tab=${t.key}`}
              className={`-mb-px border-b-2 px-1 pb-2 ${active ? "border-zinc-900 font-medium" : "border-transparent text-zinc-600"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {tab === "audit" ? (
            audit.length === 0 ? (
              <p className="text-sm text-zinc-600">Nothing has changed on this shipment yet.</p>
            ) : (
              <table className="w-full bg-white text-left text-sm shadow-sm">
                <thead className="border-b border-zinc-200 text-zinc-500">
                  <tr>
                    <th className="p-2 font-medium">When</th>
                    <th className="p-2 font-medium">Who</th>
                    <th className="p-2 font-medium">What</th>
                    <th className="p-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id} className="border-b border-zinc-100 align-top">
                      <td className="whitespace-nowrap p-2 text-zinc-600">
                        {formatDateTime(entry.at)}
                      </td>
                      <td className="p-2">{entry.actor}</td>
                      <td className="p-2 font-mono text-xs">{entry.action}</td>
                      <td className="p-2">
                        <pre className="whitespace-pre-wrap text-xs text-zinc-700">
                          {JSON.stringify(
                            { before: entry.before ?? undefined, after: entry.after ?? undefined },
                            null,
                            1,
                          )}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <>
              {notes.length > 0 && (
                <section className="mb-6" aria-label="Notes">
                  <h2 className="mb-2 text-sm font-semibold">Notes</h2>
                  <ul className="space-y-2">
                    {notes.map((note) => (
                      <li
                        key={note.id}
                        className="rounded border border-zinc-200 bg-white p-3 text-sm"
                      >
                        <p className="whitespace-pre-wrap">
                          {(note.after as { text?: string } | null)?.text}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {note.actor} · {formatDateTime(note.at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <Timeline shipment={shipment} />
            </>
          )}
        </div>
        {hasRole(user.role, "OPERATOR") ? (
          <ActionsPanel shipment={shipment} carriers={carriers} />
        ) : (
          <p className="text-sm text-zinc-600">
            You have read-only access. Ask an admin for the operator role to make changes.
          </p>
        )}
      </div>
    </>
  );
}
