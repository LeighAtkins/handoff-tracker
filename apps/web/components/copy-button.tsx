"use client";

import { useState } from "react";
import { Check, Copy } from "@/components/icons";

/** Copies a tracking number, so staff can paste it into a carrier's site or a customer email. */
export function CopyButton({ value, label, done }: { value: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      aria-label={`${label} ${value}`}
    >
      {copied ? <Check className="size-3.5 text-teal-700" /> : <Copy className="size-3.5" />}
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}
