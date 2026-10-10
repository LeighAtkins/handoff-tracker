import { STATUSES } from "@handoff/domain";
import type { ShipmentAggregateRow } from "@handoff/db";
import { ActionForm, Field } from "@/components/action-form";
import { nowForInput, TIME_ZONE } from "@/lib/format";
import {
  addManualEventAction,
  addNoteAction,
  clearOverrideAction,
  markResolvedAction,
  overrideStatusAction,
  recordHandoffAction,
} from "./actions";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-zinc-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ActionsPanel({
  shipment,
  carriers,
}: {
  shipment: ShipmentAggregateRow;
  carriers: { code: string; name: string }[];
}) {
  const hidden = <input type="hidden" name="shipmentId" value={shipment.id} />;
  const now = nowForInput();
  const currentLeg = shipment.legs.at(-1)!;

  return (
    <div className="space-y-4">
      {shipment.stuckSince && (
        <Panel title="Stuck">
          <p className="mb-3 text-sm text-zinc-600">
            Chased the carrier or confirmed it is fine? Mark it resolved. It will be flagged again
            if it goes quiet after the next event.
          </p>
          <ActionForm
            action={markResolvedAction}
            submitLabel="Mark resolved"
            testId="mark-resolved"
          >
            {hidden}
          </ActionForm>
        </Panel>
      )}

      <Panel title="Add a tracking event">
        <ActionForm action={addManualEventAction} submitLabel="Add event" testId="manual-event">
          {hidden}
          <Field label="Leg">
            <select name="legSequence" defaultValue={currentLeg.sequence}>
              {shipment.legs.map((leg) => (
                <option key={leg.id} value={leg.sequence}>
                  {leg.sequence} · {leg.carrierCode} {leg.trackingNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`When (${TIME_ZONE})`}>
            <input type="datetime-local" name="occurredAt" defaultValue={now} max={now} required />
          </Field>
          <Field label="What the carrier says">
            <input
              name="message"
              required
              maxLength={500}
              placeholder="e.g. Arrived at Tokyo depot"
            />
          </Field>
          <Field label="Location (optional)">
            <input name="location" maxLength={200} />
          </Field>
          <Field label="Means">
            <select name="status" defaultValue="">
              <option value="">No status change</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
        </ActionForm>
      </Panel>

      <Panel title="Record a handoff">
        <ActionForm action={recordHandoffAction} submitLabel="Record handoff" variant="secondary">
          {hidden}
          <Field label="Next carrier">
            <select name="carrierCode" defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {carriers
                .filter((c) => c.code !== currentLeg.carrierCode)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Their tracking number">
            <input name="trackingNumber" required maxLength={64} />
          </Field>
          <Field label={`When (${TIME_ZONE})`}>
            <input type="datetime-local" name="at" defaultValue={now} max={now} required />
          </Field>
        </ActionForm>
      </Panel>

      <Panel title="Override status">
        {shipment.overrideStatus ? (
          <ActionForm action={clearOverrideAction} submitLabel="Clear override" variant="secondary">
            {hidden}
            <p className="text-sm text-zinc-600">
              Clearing returns to the status the carrier events imply.
            </p>
          </ActionForm>
        ) : (
          <ActionForm
            action={overrideStatusAction}
            submitLabel="Override"
            variant="secondary"
            testId="override"
          >
            {hidden}
            <Field label="Status">
              <select name="status" defaultValue={shipment.status}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason (required)">
              <input
                name="reason"
                required
                placeholder="e.g. Customer confirmed delivery by email"
              />
            </Field>
          </ActionForm>
        )}
      </Panel>

      <Panel title="Add a note">
        <ActionForm action={addNoteAction} submitLabel="Add note" variant="secondary">
          {hidden}
          <Field label="Note">
            <textarea name="text" rows={3} required maxLength={2000} />
          </Field>
        </ActionForm>
      </Panel>
    </div>
  );
}
