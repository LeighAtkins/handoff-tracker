import { STATUSES } from "@handoff/domain";
import type { ShipmentAggregateRow } from "@handoff/db";
import { ActionForm, Field } from "@/components/action-form";
import { nowForInput, TIME_ZONE } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";
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
  t,
}: {
  shipment: ShipmentAggregateRow;
  carriers: { code: string; name: string }[];
  t: Dictionary;
}) {
  const hidden = <input type="hidden" name="shipmentId" value={shipment.id} />;
  const now = nowForInput();
  const currentLeg = shipment.legs.at(-1)!;
  const a = t.actions;
  const pendingLabel = a.saving;

  return (
    <div className="space-y-4">
      {shipment.stuckSince && (
        <Panel title={a.stuckTitle}>
          <p className="mb-3 text-sm text-zinc-600">{a.stuckHelp}</p>
          <ActionForm
            action={markResolvedAction}
            submitLabel={a.markResolved}
            pendingLabel={pendingLabel}
            testId="mark-resolved"
          >
            {hidden}
          </ActionForm>
        </Panel>
      )}

      <Panel title={a.addEventTitle}>
        <ActionForm
          action={addManualEventAction}
          submitLabel={a.addEvent}
          pendingLabel={pendingLabel}
          testId="manual-event"
        >
          {hidden}
          <Field label={a.leg}>
            <select name="legSequence" defaultValue={currentLeg.sequence}>
              {shipment.legs.map((leg) => (
                <option key={leg.id} value={leg.sequence}>
                  {leg.sequence} · {leg.carrierCode} {leg.trackingNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.when(TIME_ZONE)}>
            <input type="datetime-local" name="occurredAt" defaultValue={now} max={now} required />
          </Field>
          <Field label={a.message}>
            <input name="message" required maxLength={500} placeholder={a.messagePlaceholder} />
          </Field>
          <Field label={a.location}>
            <input name="location" maxLength={200} />
          </Field>
          <Field label={a.means}>
            <select name="status" defaultValue="">
              <option value="">{a.noStatusChange}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </select>
          </Field>
        </ActionForm>
      </Panel>

      <Panel title={a.handoffTitle}>
        <ActionForm
          action={recordHandoffAction}
          submitLabel={a.recordHandoff}
          pendingLabel={pendingLabel}
          variant="secondary"
        >
          {hidden}
          <Field label={a.nextCarrier}>
            <select name="carrierCode" defaultValue="">
              <option value="" disabled>
                {a.choose}
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
          <Field label={a.theirTracking}>
            <input name="trackingNumber" required maxLength={64} />
          </Field>
          <Field label={a.when(TIME_ZONE)}>
            <input type="datetime-local" name="at" defaultValue={now} max={now} required />
          </Field>
        </ActionForm>
      </Panel>

      <Panel title={a.overrideTitle}>
        {shipment.overrideStatus ? (
          <ActionForm
            action={clearOverrideAction}
            submitLabel={a.clearOverride}
            pendingLabel={pendingLabel}
            variant="secondary"
          >
            {hidden}
            <p className="text-sm text-zinc-600">{a.clearHelp}</p>
          </ActionForm>
        ) : (
          <ActionForm
            action={overrideStatusAction}
            submitLabel={a.override}
            pendingLabel={pendingLabel}
            variant="secondary"
            testId="override"
          >
            {hidden}
            <Field label={t.common.status}>
              <select name="status" defaultValue={shipment.status}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.status[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={a.reason}>
              <input name="reason" required placeholder={a.reasonPlaceholder} />
            </Field>
          </ActionForm>
        )}
      </Panel>

      <Panel title={a.noteTitle}>
        <ActionForm
          action={addNoteAction}
          submitLabel={a.addNote}
          pendingLabel={pendingLabel}
          variant="secondary"
        >
          {hidden}
          <Field label={a.note}>
            <textarea name="text" rows={3} required maxLength={2000} />
          </Field>
        </ActionForm>
      </Panel>
    </div>
  );
}
