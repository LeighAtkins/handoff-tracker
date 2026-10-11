import type { JourneyView } from "@handoff/app";
import type { ShipmentFacts } from "@handoff/carriers";
import {
  MILESTONES,
  SEGMENTS,
  type Benchmarks,
  type Insight,
  type Milestone,
} from "@handoff/domain";
import { CopyButton } from "@/components/copy-button";
import { ArrowRight, ExternalLink } from "@/components/icons";
import { SERIES, SERIES_LIGHT } from "@/components/charts";
import { CarrierChip, Callout, Pill } from "@/components/ui";
import {
  formatDate,
  formatDateTime,
  formatDay,
  formatDuration,
  TRACKING_PAGES,
} from "@/lib/format";
import { getT } from "@/lib/i18n";
import { carrierLabel, describeInsight } from "@/lib/insights";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Who carries the parcel at each milestone: 4PX until the handover, then the last mile. */
const LAST_MILE_MILESTONES: ReadonlySet<Milestone> = new Set([
  "LAST_MILE_ACCEPTED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
]);

function lastMileCarrier(view: JourneyView): string | null {
  return view.analysis.handoff?.toCarrier ?? view.input.legs[1]?.carrierCode ?? null;
}

/** The current carrier's number, which is what an action like "call them" needs. */
function currentNumber(view: JourneyView): string {
  return view.input.legs.at(-1)!.trackingNumber;
}

/** What staff should know, most urgent first, each with what to do about it. */
export async function InsightList({ view, limit = 4 }: { view: JourneyView; limit?: number }) {
  const t = await getT();
  const insights: Insight[] = view.insights.slice(0, limit);
  if (!insights.length) return null;
  const quietDays = view.analysis.lastEventAt
    ? Math.floor((Date.now() - view.analysis.lastEventAt.getTime()) / DAY_MS)
    : 0;
  return (
    <div className="grid gap-3" data-testid="insights">
      {insights.map((insight, i) => {
        const text = describeInsight(insight, {
          t,
          trackingNumber: currentNumber(view),
          quietDays,
          lastMileCarrier: lastMileCarrier(view),
        });
        return (
          <Callout
            key={i}
            severity={insight.severity}
            label={t.severity[insight.severity]}
            title={text.title}
            action={
              text.action && (
                <span className="flex items-start gap-1.5">
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-zinc-500" />
                  <span>
                    <span className="sr-only">{t.journey.whatNext}: </span>
                    {text.action}
                  </span>
                </span>
              )
            }
          >
            {text.detail}
          </Callout>
        );
      })}
    </div>
  );
}

/**
 * The journey as nine milestones, with who held the parcel, when each happened and how long it
 * took since the previous one. The handover gap is the one this app exists to watch.
 */
export async function Milestones({
  view,
  estimate,
}: {
  view: JourneyView;
  /** Shown under "Delivered" while the parcel is on its way. */
  estimate?: Date | null;
}) {
  const t = await getT();
  const { analysis } = view;
  const firstCarrier = view.input.legs[0]!.carrierCode;
  const lastMile = carrierLabel(t, lastMileCarrier(view));
  const problemAt = analysis.activeProblem ? analysis.position : null;
  const duration = (hours: number) => formatDuration(hours, t.duration);

  let previous: Date | null = null;
  const steps = MILESTONES.map((milestone) => {
    const point = analysis.milestones.find((m) => m.milestone === milestone)!;
    const sincePrevious =
      point.at && previous ? (point.at.getTime() - previous.getTime()) / 3_600_000 : null;
    if (point.at) previous = point.at;
    return { milestone, point, sincePrevious };
  });

  const label = (milestone: Milestone) =>
    milestone === "HANDED_OFF"
      ? t.journey.handedTo(lastMile)
      : milestone === "LAST_MILE_ACCEPTED"
        ? t.journey.scannedBy(lastMile)
        : t.milestones[milestone];

  return (
    <ol className="grid gap-y-4 sm:grid-cols-3 lg:grid-cols-9" data-testid="milestones">
      {steps.map(({ milestone, point, sincePrevious }, index) => {
        const current = analysis.position === milestone && !analysis.finished;
        const done = point.reached && !current;
        const problem = problemAt === milestone;
        const owner = LAST_MILE_MILESTONES.has(milestone) ? lastMileCarrier(view) : firstCarrier;
        const isHandoffGap = milestone === "LAST_MILE_ACCEPTED";
        const waitingGap = isHandoffGap && analysis.handoff?.waiting;
        return (
          <li key={milestone} className="relative flex gap-3 lg:flex-col lg:gap-2 lg:pr-2">
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={`absolute top-3 left-3 hidden h-0.5 w-full lg:block ${steps[index + 1]!.point.reached ? "bg-teal-500" : "bg-zinc-200"}`}
              />
            )}
            <span
              className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-4 ring-white ${
                problem
                  ? "bg-red-600 text-white"
                  : current
                    ? "bg-white text-teal-700 ring-teal-100 outline-2 outline-teal-600"
                    : done
                      ? point.at
                        ? "bg-teal-600 text-white"
                        : "bg-teal-100 text-teal-800"
                      : "bg-zinc-100 text-zinc-400"
              }`}
            >
              {problem ? "!" : done ? "✓" : index + 1}
            </span>
            <div className="min-w-0 text-xs">
              <p
                className={`text-[13px] leading-snug font-medium ${point.reached ? "text-zinc-900" : "text-zinc-400"}`}
              >
                {label(milestone)}
              </p>
              {owner && point.reached && (
                <p className="mt-0.5">
                  <CarrierChip code={owner} />
                </p>
              )}
              <p className="mt-0.5 text-zinc-500">
                {point.at
                  ? formatDateTime(point.at)
                  : point.reached
                    ? t.journey.notReported
                    : milestone === "DELIVERED" && estimate
                      ? `~ ${formatDay(estimate)}`
                      : ""}
              </p>
              {sincePrevious !== null && index > 0 && (
                <p
                  className={`mt-0.5 font-medium tabular-nums ${isHandoffGap ? "text-violet-800" : "text-zinc-600"}`}
                >
                  +{duration(sincePrevious)}
                </p>
              )}
              {waitingGap && analysis.handoff?.gapHours != null && (
                <p className="mt-0.5 font-medium text-amber-800">
                  {t.journey.soFar(duration(analysis.handoff.gapHours))}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The handful of facts staff look for first. */
export async function JourneyFacts({
  view,
  facts,
  estimate,
}: {
  view: JourneyView;
  facts?: ShipmentFacts | null;
  estimate?: { from: Date | null; to: Date | null; source: string } | null;
}) {
  const t = await getT();
  const { analysis } = view;
  const duration = (hours: number) => formatDuration(hours, t.duration);
  const leg2 = view.input.legs[1];
  const planned = !leg2 && facts?.lastMile ? facts.lastMile : null;
  const lastMile =
    leg2 ??
    (planned ? { carrierCode: planned.carrierCode, trackingNumber: planned.trackingNumber } : null);
  const delivered = analysis.milestones.find((m) => m.milestone === "DELIVERED")!;
  const ownEstimate = view.insights.find((i) => i.code === "ESTIMATE");

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Fact label={t.journey.nowWith}>
        {analysis.finished ? (
          <span>
            {delivered.at
              ? `${t.milestones.DELIVERED} · ${formatDateTime(delivered.at)}`
              : t.status[view.input.status]}
          </span>
        ) : analysis.handoff?.waiting ? (
          // 4PX has handed it over, so it is the last mile's responsibility even before a scan.
          <span className="flex flex-wrap items-center gap-1.5">
            {analysis.handoff.toCarrier && <CarrierChip code={analysis.handoff.toCarrier} />}
            <span className="text-amber-800">{t.journey.notScannedYet}</span>
          </span>
        ) : analysis.holder ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <CarrierChip code={analysis.holder.carrierCode} />
            <span className="text-zinc-700">{analysis.holder.location ?? ""}</span>
          </span>
        ) : (
          <span className="text-zinc-500">{t.journey.unknown}</span>
        )}
      </Fact>
      <Fact label={t.journey.inTransit}>
        {analysis.totalHours === null ? "—" : duration(analysis.totalHours)}
        {analysis.startedAt && (
          <span className="ml-1 text-xs text-zinc-500">· {formatDate(analysis.startedAt)} →</span>
        )}
      </Fact>
      <Fact label={t.journey.handoffGap}>
        {analysis.handoff?.gapHours != null ? (
          analysis.handoff.waiting ? (
            <span className="text-amber-800">
              {t.journey.soFar(duration(analysis.handoff.gapHours))}
            </span>
          ) : (
            duration(analysis.handoff.gapHours)
          )
        ) : (
          "—"
        )}
      </Fact>
      <Fact label={t.journey.lastMile}>
        {lastMile ? (
          <span className="block">
            <span className="flex flex-wrap items-center gap-1.5">
              <CarrierChip code={lastMile.carrierCode} />
              <span className="font-mono text-[13px]">{lastMile.trackingNumber}</span>
              <CopyButton
                value={lastMile.trackingNumber}
                label={t.journey.copy}
                done={t.journey.copied}
              />
            </span>
            {planned && (
              <span className="mt-0.5 block text-xs text-zinc-500">{t.journey.plannedNote}</span>
            )}
            {TRACKING_PAGES[lastMile.carrierCode] && (
              <a
                href={TRACKING_PAGES[lastMile.carrierCode]}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-xs text-teal-800 hover:underline"
              >
                {t.journey.trackingSite(carrierLabel(t, lastMile.carrierCode))}
                <ExternalLink className="size-3" />
              </a>
            )}
          </span>
        ) : (
          <span className="text-zinc-500">{t.journey.unknown}</span>
        )}
      </Fact>
      {!analysis.finished && (
        <Fact label={t.journey.expected}>
          {estimate && (estimate.from || estimate.to) ? (
            <span className="block">
              {[estimate.from, estimate.to]
                .filter(Boolean)
                .map((d) => formatDay(d))
                .join(" – ")}
              <span className="block text-xs text-zinc-500">
                {t.journey.providerEstimate(estimate.source)}
              </span>
            </span>
          ) : ownEstimate && ownEstimate.code === "ESTIMATE" ? (
            <span className="block">
              {formatDay(ownEstimate.estimate.earliest)} – {formatDay(ownEstimate.estimate.latest)}
              <span className="block text-xs text-zinc-500">{t.journey.ourEstimate}</span>
            </span>
          ) : (
            <span className="text-zinc-500">{t.journey.noEstimate}</span>
          )}
        </Fact>
      )}
      {facts && (facts.originCountry || facts.destinationCountry) && (
        <Fact label={t.journey.route}>
          {[facts.originCountry, facts.destinationCountry].filter(Boolean).join(" → ")}
          {facts.weightKg ? (
            <span className="ml-1 text-xs text-zinc-500">· {facts.weightKg} kg</span>
          ) : null}
        </Fact>
      )}
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-zinc-900">{children}</dd>
    </div>
  );
}

/**
 * Each stage of this parcel against the usual: a bar for this parcel, a tick at the median and a
 * band to the 80th percentile, learnt from every parcel tracked here.
 */
export async function StageTimes({
  view,
  benchmarks,
  compact = false,
}: {
  view: JourneyView;
  benchmarks: Benchmarks;
  /** Label above the bar instead of beside it, for a narrow column. */
  compact?: boolean;
}) {
  const t = await getT();
  const duration = (hours: number) => formatDuration(hours, t.duration);
  const rows = SEGMENTS.flatMap(({ key }) => {
    const segment = view.analysis.segments.find((s) => s.key === key)!;
    const usual = benchmarks.segments[key];
    return segment.hours === null ? [] : [{ key, segment, usual }];
  });
  if (!rows.length) return null;
  const scale =
    Math.max(1, ...rows.map((r) => Math.max(r.segment.hours ?? 0, r.usual?.p80 ?? 0))) * 1.05;
  const pct = (hours: number) => `${Math.min(100, (hours / scale) * 100)}%`;

  return (
    <div>
      <p className="text-xs text-zinc-500">{t.journey.stagesCaption}</p>
      <ul className="mt-3 space-y-2.5">
        {rows.map(({ key, segment, usual }) => {
          const slow = usual && segment.hours! > usual.p80;
          return (
            <li
              key={key}
              className={`grid items-center gap-x-3 text-sm ${compact ? "grid-cols-[1fr_6.5rem] gap-y-1" : "grid-cols-[10rem_1fr_7rem]"}`}
            >
              <span
                className={`${key === "HANDOFF" ? "font-medium text-zinc-900" : "text-zinc-700"} ${compact ? "col-span-2" : ""}`}
              >
                {t.segments[key]}
              </span>
              <span className="relative h-5" aria-hidden>
                {usual && (
                  <span
                    className="absolute top-0.5 h-4 rounded-[3px] bg-teal-50 ring-1 ring-teal-100 ring-inset"
                    style={{ left: 0, width: pct(usual.p80) }}
                  />
                )}
                <span
                  className="absolute top-1.5 h-2 rounded-l-[2px] rounded-r-[4px]"
                  style={{
                    left: 0,
                    width: pct(segment.hours!),
                    // Running now: the lighter step, labelled "so far". Slow: status colour + label.
                    background: segment.ongoing ? SERIES_LIGHT : slow ? "#ec835a" : SERIES,
                  }}
                />
                {usual && (
                  <span
                    className="absolute top-0 h-5 w-0.5 rounded bg-zinc-700"
                    style={{ left: pct(usual.median) }}
                  />
                )}
              </span>
              <span className="text-right text-xs whitespace-nowrap text-zinc-600 tabular-nums">
                <span className="font-medium text-zinc-900">{duration(segment.hours!)}</span>
                {segment.ongoing && <span> {t.journey.soFarShort}</span>}
                {usual && (
                  <span className="block text-zinc-500">
                    {t.journey.usual(duration(usual.median))}
                  </span>
                )}
                {slow && !segment.ongoing && (
                  <Pill className="mt-0.5 bg-orange-50 text-orange-900">▲ {t.journey.slower}</Pill>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
