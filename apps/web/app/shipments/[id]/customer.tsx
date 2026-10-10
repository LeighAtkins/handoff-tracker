"use client";

import { useActionState } from "react";
import { revealCustomerAction, type RevealState } from "./reveal-action";

/** Masked by default (P3). Revealing is one click, and is written to the audit log. */
export function Customer({
  orderId,
  maskedName,
  maskedPostcode,
  country,
  labels,
}: {
  orderId: string;
  maskedName: string;
  maskedPostcode: string;
  country: string;
  labels: { customer: string; destination: string; reveal: string; revealTitle: string };
}) {
  const [state, reveal, pending] = useActionState<RevealState, FormData>(
    revealCustomerAction,
    null,
  );
  const revealed = state && "customerName" in state ? state : null;

  return (
    <>
      <div>
        <dt className="text-zinc-500">{labels.customer}</dt>
        <dd data-testid="customer-name">
          {revealed ? revealed.customerName : maskedName}{" "}
          {!revealed && (
            <form action={reveal} className="inline">
              <input type="hidden" name="orderId" value={orderId} />
              <button
                className="text-xs text-zinc-600 underline"
                disabled={pending}
                title={labels.revealTitle}
              >
                {pending ? "…" : labels.reveal}
              </button>
            </form>
          )}
          {state && "error" in state && (
            <span className="ml-2 text-xs text-red-700">{state.error}</span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-zinc-500">{labels.destination}</dt>
        <dd>
          {country} {revealed ? revealed.destinationPostcode : maskedPostcode}
        </dd>
      </div>
    </>
  );
}
