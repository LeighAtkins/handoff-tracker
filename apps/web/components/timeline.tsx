import { classifyStage } from "@handoff/carriers";
import type { ShipmentAggregateRow } from "@handoff/db";
import { LastChecked } from "@/components/last-checked";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/lib/i18n";

/**
 * Vertical timeline grouped by Leg, newest first, with a marker where responsibility passed
 * from one carrier to the next.
 */
export async function Timeline({ shipment }: { shipment: ShipmentAggregateRow }) {
  const t = await getT();
  const legs = [...shipment.legs].reverse();

  return (
    <ol className="space-y-0">
      {legs.map((leg) => {
        const handoffIn = shipment.handoffs.find((h) => h.toLegId === leg.id);
        const events = [...leg.events].reverse();
        return (
          <li key={leg.id}>
            <section
              className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
              aria-label={`Leg ${leg.sequence}`}
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 px-4 py-2">
                <h3 className="font-medium">
                  {t.detail.leg} {leg.sequence} · {leg.carrierCode}{" "}
                  <span className="font-mono text-sm text-zinc-600">{leg.trackingNumber}</span>
                </h3>
                <p className="text-xs text-zinc-500">
                  {formatDateTime(leg.startedAt)} →{" "}
                  {leg.endedAt ? formatDateTime(leg.endedAt) : "now"}
                  {!leg.endedAt && (
                    <>
                      {` · ${t.detail.checked} `}
                      <LastChecked leg={leg} />
                    </>
                  )}
                </p>
              </header>
              {events.length === 0 ? (
                <p className="px-4 py-3 text-sm text-zinc-500">
                  {t.detail.noEvents(leg.carrierCode)}
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
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                          {(() => {
                            const stage = classifyStage(leg.carrierCode, event, leg.sequence);
                            return stage ? (
                              <span className="rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-900">
                                {t.stages[stage]}
                              </span>
                            ) : null;
                          })()}
                          <span>
                            {[
                              event.location,
                              event.source === "MANUAL" ? t.detail.enteredManually : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
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
                            {t.detail.unrecognised}
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
                  {t.detail.handoff(
                    handoffIn.fromLeg.carrierCode,
                    handoffIn.toLeg.carrierCode,
                    formatDateTime(handoffIn.detectedAt),
                  )}
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
