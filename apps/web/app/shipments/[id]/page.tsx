import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { daysQuiet, maskName, maskPostcode } from "@handoff/domain";
import { requireUser } from "@/lib/auth/session";
import { getPrisma, shipmentAggregateInclude, toShipmentState } from "@handoff/db";
import { StatusBadge, StuckBadge } from "@/components/status-badge";
import { Timeline } from "@/components/timeline";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { hasRole } from "@handoff/app";
import { ActionsPanel } from "./actions-panel";
import { Customer } from "./customer";

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
  const t = await getT();
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
          ← {t.shipments.title}
        </Link>
      </p>
      <header className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold">{shipment.order.sourceOrderNumber}</h1>
        <StatusBadge status={shipment.status} />
        {shipment.stuckSince && <StuckBadge />}
        <span className="ml-auto flex gap-3 text-sm">
          <Link
            href={`/shipments/${id}/print?doc=slip`}
            prefetch={false}
            className="text-zinc-600 underline"
          >
            {t.detail.slip}
          </Link>
          <Link
            href={`/shipments/${id}/print?doc=label`}
            prefetch={false}
            className="text-zinc-600 underline"
          >
            {t.detail.label}
          </Link>
        </span>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Customer
          orderId={shipment.orderId}
          maskedName={maskName(shipment.order.customerName)}
          maskedPostcode={maskPostcode(shipment.order.destinationPostcode)}
          country={shipment.order.destinationCountry}
          labels={{
            customer: t.detail.customer,
            destination: t.detail.destination,
            reveal: t.detail.reveal,
            revealTitle: t.detail.revealTitle,
          }}
        />
        <div>
          <dt className="text-zinc-500">{t.common.lastEvent}</dt>
          <dd>
            {formatDateTime(shipment.lastEventAt)} ({t.detail.quiet(quiet)})
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">{t.detail.stuckSince}</dt>
          <dd>{formatDateTime(shipment.stuckSince)}</dd>
        </div>
      </dl>

      {shipment.overrideStatus && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          {t.detail.overrideBanner(
            t.status[shipment.overrideStatus],
            shipment.overrideBy ?? "",
            formatDateTime(shipment.overrideAt),
            shipment.overrideReason ?? "",
          )}
        </p>
      )}

      <nav className="mt-6 flex gap-4 border-b border-zinc-200 text-sm">
        {[
          { key: "timeline", label: t.detail.timeline },
          { key: "audit", label: t.detail.audit },
        ].map((item) => {
          const active = (tab ?? "timeline") === item.key;
          return (
            <Link
              key={item.key}
              href={
                item.key === "timeline" ? `/shipments/${id}` : `/shipments/${id}?tab=${item.key}`
              }
              className={`-mb-px border-b-2 px-1 pb-2 ${active ? "border-zinc-900 font-medium" : "border-transparent text-zinc-600"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {tab === "audit" ? (
            audit.length === 0 ? (
              <p className="text-sm text-zinc-600">{t.detail.noChanges}</p>
            ) : (
              <table className="w-full bg-white text-left text-sm shadow-sm">
                <thead className="border-b border-zinc-200 text-zinc-500">
                  <tr>
                    <th className="p-2 font-medium">{t.detail.when}</th>
                    <th className="p-2 font-medium">{t.detail.who}</th>
                    <th className="p-2 font-medium">{t.detail.what}</th>
                    <th className="p-2 font-medium">{t.detail.details}</th>
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
                <section className="mb-6" aria-label={t.detail.notes}>
                  <h2 className="mb-2 text-sm font-semibold">{t.detail.notes}</h2>
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
          <ActionsPanel shipment={shipment} carriers={carriers} t={t} />
        ) : (
          <p className="text-sm text-zinc-600">{t.detail.readOnly}</p>
        )}
      </div>
    </>
  );
}
