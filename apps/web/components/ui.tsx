import type { ReactNode } from "react";
import type { Severity } from "@handoff/domain";
import { AlertOctagon, AlertTriangle, CheckCircle, InfoCircle } from "@/components/icons";

/** Shared look: hairline cards on a quiet page, teal for the one thing to click. */
export const button = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-60",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700",
  link: "font-medium text-teal-800 underline decoration-teal-800/30 underline-offset-2 hover:decoration-teal-800",
};

export const input =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-zinc-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-zinc-500">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-zinc-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  children,
  className = "",
  ...props
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={`rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** A headline number with its context. Proportional figures: tabular only in columns. */
export function StatTile({
  label,
  value,
  note,
  tone = "neutral",
  icon,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: "neutral" | "critical" | "good";
  icon?: ReactNode;
  children?: ReactNode;
}) {
  const ring =
    tone === "critical"
      ? "border-red-200 bg-red-50/60"
      : tone === "good"
        ? "border-emerald-200 bg-emerald-50/50"
        : "border-zinc-200 bg-white";
  return (
    <div
      className={`flex flex-col rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${ring}`}
    >
      <p className="flex items-center gap-1.5 text-sm text-zinc-600">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">{value}</p>
      {note && <p className="mt-1 text-xs text-zinc-500">{note}</p>}
      {children && <div className="mt-auto pt-3">{children}</div>}
    </div>
  );
}

const SEVERITY: Record<Severity, { box: string; icon: string; Icon: typeof InfoCircle }> = {
  critical: { box: "border-red-200 bg-red-50", icon: "text-red-600", Icon: AlertOctagon },
  warning: { box: "border-amber-200 bg-amber-50", icon: "text-amber-600", Icon: AlertTriangle },
  info: { box: "border-sky-200 bg-sky-50", icon: "text-sky-700", Icon: InfoCircle },
  good: { box: "border-emerald-200 bg-emerald-50", icon: "text-emerald-700", Icon: CheckCircle },
};

/** A message with a severity: icon + words always, never colour alone. */
export function Callout({
  severity,
  title,
  children,
  action,
  label,
}: {
  severity: Severity;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** The severity in words, for screen readers. */
  label: string;
}) {
  const style = SEVERITY[severity];
  return (
    <div className={`flex gap-3 rounded-xl border p-4 ${style.box}`} data-severity={severity}>
      <style.Icon className={`mt-0.5 size-5 shrink-0 ${style.icon}`} title={label} />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-zinc-900">{title}</p>
        {children && <div className="mt-0.5 text-zinc-700">{children}</div>}
        {action && <p className="mt-2 font-medium text-zinc-900">{action}</p>}
      </div>
    </div>
  );
}

export function SeverityIcon({ severity, label }: { severity: Severity; label: string }) {
  const style = SEVERITY[severity];
  return <style.Icon className={`size-4 shrink-0 ${style.icon}`} title={label} />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">
      {children}
    </p>
  );
}

export function Pill({
  children,
  className = "bg-zinc-100 text-zinc-700",
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

/** Carrier name as a quiet chip, so mixed-carrier lists scan easily. */
export function CarrierChip({ code }: { code: string }) {
  const tone =
    code === "4PX"
      ? "bg-indigo-50 text-indigo-800 ring-indigo-200"
      : code === "SAGAWA"
        ? "bg-sky-50 text-sky-800 ring-sky-200"
        : "bg-zinc-50 text-zinc-700 ring-zinc-200";
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset ${tone}`}
    >
      {code}
    </span>
  );
}
