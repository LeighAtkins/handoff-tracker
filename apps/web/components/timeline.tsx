import type { ShipmentAggregateRow } from "@handoff/db";
import { LastChecked } from "@/components/last-checked";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";

/**
 * Vertical timeline grouped by Leg, newest first, with a marker where responsibility passed
 * from one carrier to the next.
 */
export function Timeline({ shipment }: { shipment: ShipmentAggregateRow }) {
  const legs = [...shipment.legs].reverse();

  return (
    <ol className="space-y-0">
      {legs.map((leg) => {
        const handoffIn = shipment.handoffs.find((h) => h.toLegId === leg.id);
        const events = [...leg.events].reverse();
        return (
          <li key={leg.id}>
            <section
              className="rounded border border-zinc-200 bg-white"
              aria-label={`Leg ${leg.sequence}`}
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 px-4 py-2">
                <h3 className="font-medium">
                  Leg {leg.sequence} · {leg.carrierCode}{" "}
                  <span className="font-mono text-sm text-zinc-600">{leg.trackingNumber}</span>
                </h3>
                <p className="text-xs text-zinc-500">
                  {formatDateTime(leg.startedAt)} →{" "}
                  {leg.endedAt ? formatDateTime(leg.endedAt) : "now"}
                  {!leg.endedAt && (
                    <>
                      {" · checked "}
                      <LastChecked leg={leg} />
                    </>
                  )}
                </p>
              </header>
              {events.length === 0 ? (
                <p className="px-4 py-3 text-sm text-zinc-500">
                  No events from {leg.carrierCode} yet.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {events.map((event) => (
                    <li
                      key={event.id}
                      className="grid grid-cols-[9rem_1fr_auto] gap-3 px-4 py-2 text-sm"
                    >
                      <time className="text-zinc-500" dateTime={event.occurredAt.toISOString()}>
                        {formatDateTime(event.occurredAt)}
                      </time>
                      <div>
                        <p>{event.rawMessage}</p>
                        <p className="text-xs text-zinc-500">
                          {[event.location, event.source === "MANUAL" ? "entered manually" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div>
                        {event.normalisedStatus ? (
                          <StatusBadge status={event.normalisedStatus} />
                        ) : (
                          <span
                            className="text-xs text-amber-700"
                            title="No mapping for this carrier message yet"
                          >
                            unrecognised
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {handoffIn && (
              <div
                className="flex items-center gap-3 py-3 pl-4 text-sm text-violet-900"
                data-testid="handoff-marker"
              >
                <span className="h-6 w-0.5 bg-violet-300" aria-hidden />
                <span>
                  Handoff {handoffIn.fromLeg.carrierCode} → {handoffIn.toLeg.carrierCode} at{" "}
                  {formatDateTime(handoffIn.detectedAt)}
                  <span className="text-zinc-500">
                    {" "}
                    · {handoffIn.source.replaceAll("_", " ").toLowerCase()}
                  </span>
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
