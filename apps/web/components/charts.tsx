import type { ReactNode } from "react";

/**
 * Small server-rendered charts, built to the dataviz method: one hue per series (validated with
 * the palette checker), thin marks with 4px rounded data-ends, hairline axes, selective labels,
 * a hover/focus tooltip on every mark and a table view for every chart.
 *
 * Colours (light surface, all checks pass): series #0d9488, darker step #0f766e, lighter step
 * #14b8a6 (ordinal pair with #0f766e), problem = status critical #d03b3b (always with a label).
 */
export const SERIES = "#0d9488";
export const SERIES_DARK = "#0f766e";
export const SERIES_LIGHT = "#14b8a6";
export const CRITICAL = "#d03b3b";

/** A chart card: title, caption, legend, the chart, and its table twin. */
export function ChartCard({
  title,
  caption,
  legend,
  table,
  tableLabel,
  children,
  className = "",
}: {
  title: ReactNode;
  caption?: ReactNode;
  legend?: { label: string; color: string; shape?: "bar" | "line" }[];
  table: { head: string[]; rows: (string | number)[][] };
  tableLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={`flex flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}
    >
      <figcaption>
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {caption && <p className="mt-0.5 text-xs text-zinc-500">{caption}</p>}
      </figcaption>
      {legend && legend.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={item.shape === "line" ? "h-0.5 w-3.5 rounded" : "size-2.5 rounded-sm"}
                style={{ background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex-1">{children}</div>
      <details className="mt-4 text-xs text-zinc-600">
        <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-800">
          {tableLabel}
        </summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-zinc-500">
            <tr>
              {table.head.map((h) => (
                <th key={h} className="py-1 pr-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-t border-zinc-100">
                {row.map((cell, j) => (
                  <td key={j} className="py-1 pr-3">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** The tooltip that a mark's hit area shows on hover and keyboard focus. Value first, label second. */
function Tip({
  value,
  label,
  align = "center",
}: {
  value: ReactNode;
  label: ReactNode;
  align?: "center" | "end";
}) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute bottom-full z-20 mb-2 hidden whitespace-nowrap rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block group-focus:block ${align === "center" ? "left-1/2 -translate-x-1/2" : "right-0"}`}
    >
      <span className="block font-semibold">{value}</span>
      <span className="block text-zinc-300">{label}</span>
    </span>
  );
}

/**
 * Horizontal bars, optionally split into a base and a flagged part (e.g. on track / open
 * problem). Values sit at the bar tip; the 2px gap separates the two parts.
 */
export function BarList({
  rows,
  baseLabel,
  flagLabel,
  valueLabel,
}: {
  rows: { label: string; base: number; flagged?: number }[];
  baseLabel: string;
  flagLabel?: string;
  valueLabel: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.base + (r.flagged ?? 0)));
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const total = row.base + (row.flagged ?? 0);
        return (
          <li key={row.label} className="grid grid-cols-[9.5rem_1fr] items-center gap-3 text-sm">
            <span className="truncate text-zinc-700" title={row.label}>
              {row.label}
            </span>
            <span
              tabIndex={0}
              aria-label={`${row.label}: ${valueLabel(total)}${row.flagged ? `, ${flagLabel} ${row.flagged}` : ""}`}
              className="group relative flex h-6 items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40"
            >
              <span className="flex h-3.5 gap-[2px]" style={{ width: `${(total / max) * 85}%` }}>
                {row.base > 0 && (
                  <span
                    className={`h-full ${row.flagged ? "rounded-l-[2px]" : "rounded-r-[4px] rounded-l-[2px]"} transition-opacity group-hover:opacity-80`}
                    style={{ width: `${(row.base / total) * 100}%`, background: SERIES }}
                  />
                )}
                {!!row.flagged && (
                  <span
                    className="h-full rounded-r-[4px] transition-opacity group-hover:opacity-80"
                    style={{ width: `${(row.flagged / total) * 100}%`, background: CRITICAL }}
                  />
                )}
              </span>
              <span className="text-sm font-medium text-zinc-900 tabular-nums">{total}</span>
              <Tip
                value={valueLabel(total)}
                label={
                  row.flagged ? `${baseLabel} ${row.base} · ${flagLabel} ${row.flagged}` : row.label
                }
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical columns with the value on each cap (few columns, so every one is labelled). */
export function Columns({
  columns,
  valueLabel,
  height = 160,
}: {
  columns: { label: string; value: number; tip: string; highlight?: boolean }[];
  valueLabel: (n: number) => string;
  height?: number;
}) {
  const max = Math.max(1, ...columns.map((c) => c.value));
  return (
    <div>
      <div className="flex items-end gap-2 border-b border-zinc-300" style={{ height }}>
        {columns.map((column) => (
          <div
            key={column.label}
            tabIndex={0}
            aria-label={`${column.tip}: ${valueLabel(column.value)}`}
            className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40"
          >
            <span className="mb-1 text-xs font-medium text-zinc-700 tabular-nums">
              {column.value}
            </span>
            <span
              className="w-full max-w-6 rounded-t-[4px] transition-opacity group-hover:opacity-80"
              style={{
                height: `${(column.value / max) * (height - 24)}px`,
                minHeight: column.value ? 2 : 0,
                background: column.highlight ? SERIES_DARK : SERIES,
              }}
            />
            <Tip value={valueLabel(column.value)} label={column.tip} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {columns.map((column) => (
          <span key={column.label} className="flex-1 text-center text-[11px] text-zinc-500">
            {column.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Median bar with a lighter extension to the 80th percentile: "usually", and "nearly always". */
export function RangeBars({
  rows,
  format,
  medianLabel,
  p80Label,
}: {
  rows: { label: string; median: number; p80: number; emphasis?: boolean }[];
  format: (hours: number) => string;
  medianLabel: string;
  p80Label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.p80));
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[9.5rem_1fr] items-center gap-3 text-sm">
          <span
            className={`truncate ${row.emphasis ? "font-semibold text-zinc-900" : "text-zinc-700"}`}
          >
            {row.label}
          </span>
          <span
            tabIndex={0}
            aria-label={`${row.label}: ${medianLabel} ${format(row.median)}, ${p80Label} ${format(row.p80)}`}
            className="group relative flex h-6 items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40"
          >
            <span className="flex h-3.5 gap-[2px]" style={{ width: `${(row.p80 / max) * 75}%` }}>
              <span
                className="h-full rounded-l-[2px]"
                style={{ width: `${(row.median / row.p80) * 100}%`, background: SERIES_DARK }}
              />
              <span
                className="h-full flex-1 rounded-r-[4px]"
                style={{ background: SERIES_LIGHT, opacity: 0.55 }}
              />
            </span>
            <span className="text-xs whitespace-nowrap text-zinc-600 tabular-nums">
              <span className="font-medium text-zinc-900">{format(row.median)}</span> ·{" "}
              {format(row.p80)}
            </span>
            <Tip
              value={`${medianLabel} ${format(row.median)}`}
              label={`${p80Label} ${format(row.p80)}`}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One series over time, with a labelled target line. Each point has a 24px+ hit column that
 * shows its value on hover and focus.
 */
export function LineChart({
  points,
  target,
  targetLabel,
  format,
  height = 170,
}: {
  points: { label: string; value: number | null; tip: string }[];
  target?: number;
  targetLabel?: string;
  format: (n: number) => string;
  height?: number;
}) {
  const width = 600;
  const pad = { top: 12, right: 12, bottom: 4, left: 28 };
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  // Clean steps (1, 2, 5, 10) with headroom above the highest point or the target.
  const highest = Math.max(target ?? 0, ...values, 1);
  const step = highest <= 5 ? 1 : highest <= 12 ? 2 : highest <= 30 ? 5 : 10;
  const top = Math.ceil((highest * 1.15) / step) * step;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (i: number) =>
    pad.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const path = points
    .map((p, i) => (p.value === null ? null : `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const last = [...points].reverse().find((p) => p.value !== null);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-hidden
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#e4e4e7"
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={y(tick)}
              dy="0.32em"
              textAnchor="end"
              fontSize="11"
              fill="#71717a"
            >
              {tick}
            </text>
          </g>
        ))}
        {target !== undefined && (
          <g>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(target)}
              y2={y(target)}
              stroke="#a1a1aa"
              strokeWidth={1.25}
            />
            {/* Left end, so it never collides with the latest value labelled at the right. */}
            <text x={pad.left + 4} y={y(target) - 5} fontSize="11" fill="#52525b">
              {targetLabel}
            </text>
          </g>
        )}
        <polyline
          points={path}
          fill="none"
          stroke={SERIES}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) =>
          p.value === null ? null : (
            <circle
              key={i}
              cx={x(i)}
              cy={y(p.value)}
              r={4}
              fill={SERIES}
              stroke="#fff"
              strokeWidth={2}
            />
          ),
        )}
        {last && last.value !== null && (
          <text
            x={x(points.lastIndexOf(last))}
            y={y(last.value) - 10}
            textAnchor="middle"
            fontSize="12"
            fontWeight={600}
            fill="#18181b"
          >
            {format(last.value)}
          </text>
        )}
      </svg>
      <div
        className="absolute inset-0 flex"
        style={{
          paddingLeft: `${(pad.left / width) * 100}%`,
          paddingRight: `${(pad.right / width) * 100}%`,
        }}
      >
        {points.map((p, i) => (
          <div
            key={i}
            tabIndex={0}
            aria-label={`${p.tip}: ${p.value === null ? "—" : format(p.value)}`}
            className="group relative flex-1 outline-none focus-visible:bg-teal-600/5 hover:bg-zinc-900/[0.03]"
          >
            <Tip
              value={p.value === null ? "—" : format(p.value)}
              label={p.tip}
              align={i === points.length - 1 ? "end" : "center"}
            />
          </div>
        ))}
      </div>
      <div
        className="mt-1 flex"
        style={{
          paddingLeft: `${(pad.left / width) * 100}%`,
          paddingRight: `${(pad.right / width) * 100}%`,
        }}
      >
        {points.map((p, i) => (
          <span key={i} className="flex-1 text-center text-[11px] text-zinc-500">
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A 12-point-style sparkline for a stat tile: de-emphasis grey, latest point in the accent. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const width = 120;
  const height = 28;
  const known = values.flatMap((v) => (v === null ? [] : [v]));
  if (known.length < 2) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const coords = values.flatMap((v, i) => (v === null ? [] : [[x(i), y(v)] as const]));
  const lastPoint = coords.at(-1)!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-28" aria-hidden>
      <polyline
        points={coords.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="#a1a1aa"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={lastPoint[0]}
        cy={lastPoint[1]}
        r={3}
        fill={SERIES}
        stroke="#fff"
        strokeWidth={1.5}
      />
    </svg>
  );
}
