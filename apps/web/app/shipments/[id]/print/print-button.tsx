"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white"
    >
      {label}
    </button>
  );
}
