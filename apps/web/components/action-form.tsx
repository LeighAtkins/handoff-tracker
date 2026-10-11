"use client";

import { useActionState, type ReactNode } from "react";

type ActionState = { ok: boolean; message: string } | null;

/** A form bound to a Server Action that shows the action's success or error message inline. */
export function ActionForm({
  action,
  submitLabel,
  children,
  variant = "primary",
  testId,
  pendingLabel = "Saving…",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  children?: ReactNode;
  variant?: "primary" | "secondary";
  testId?: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-2" data-testid={testId}>
      {children}
      <div className="flex items-center gap-3">
        <button
          disabled={pending}
          className={
            variant === "primary"
              ? "rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50"
              : "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-zinc-50 disabled:opacity-50"
          }
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        {state && (
          <p
            role={state.ok ? "status" : "alert"}
            className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-zinc-600">{label}</span>
      <div className="mt-1 [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:border-zinc-300 [&_input]:px-2 [&_input]:py-1.5 [&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-zinc-300 [&_select]:bg-white [&_select]:px-2 [&_select]:py-1.5 [&_textarea]:w-full [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-zinc-300 [&_textarea]:px-2 [&_textarea]:py-1.5">
        {children}
      </div>
    </label>
  );
}
