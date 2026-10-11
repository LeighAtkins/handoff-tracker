import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  carrierForNumber,
  loadBenchmarks,
  lookupJourney,
  lookupTracking,
  normaliseTrackingNumber,
  viewJourney,
  type LookupResult,
} from "@handoff/app";
import { isFourPxCode, SAMPLE_NUMBERS, type AttributedEvent } from "@handoff/carriers";
import type { JourneyEvent } from "@handoff/domain";
import { getPrisma } from "@handoff/db";
import { CopyButton } from "@/components/copy-button";
import { ArrowRight, Bolt, Clock, InfoCircle, Refresh } from "@/components/icons";
import { InsightList, JourneyFacts, Milestones, StageTimes } from "@/components/journey";
import { StatusBadge, StuckBadge } from "@/components/status-badge";
import { Callout, Card, CardHeader, CarrierChip, Pill, button } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatAgo, formatDateTime } from "@/lib/format";
import { getAgo, getT } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Params = Promise<{ number: string }>;
type SearchParams = Promise<{ refresh?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return { title: decodeURIComponent((await params).number) };
}

export default async function LookupPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const [t, ago] = await Promise.all([getT(), getAgo()]);
  const trackingNumber = normaliseTrackingNumber(decodeURIComponent((await params).number));
  if (!trackingNumber) notFound();
  const prisma = getPrisma();

  // "Check again" asks the provider now, then shows the clean URL (a reload must not re-ask).
  if ((await searchParams).refresh === "1") {
    await lookupTracking(prisma, { trackingNumber, actor: user.email, refresh: true });
    redirect(`/track/${trackingNumber}`);
  }

  const result = await lookupTracking(prisma, { trackingNumber, actor: user.email });
  const now = new Date();
  const checked = (at: Date | null) =>
    at && now.getTime() - at.getTime() < 60_000
      ? t.lookup.checkedJustNow
      : t.lookup.checked(formatAgo(at, now, ago));
  const source = result.provider ? (t.lookup.sources[result.provider] ?? result.provider) : null;
  const sample = SAMPLE_NUMBERS.find((s) => s.trackingNumber === trackingNumber);

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/track" className="text-zinc-600 hover:text-zinc-900">
          ← {t.track.title}
        </Link>
      </p>

      {result.state === "READY" ? (
        <Journey result={result} now={now} source={source} checked={checked(result.fetchedAt)} />
      ) : (
        <>
          <Header
            trackingNumber={trackingNumber}
            source={source}
            checked={checked(result.fetchedAt)}
            result={result}
          />
          <NotReady result={result} source={source} />
        </>
      )}

      {sample && (
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <InfoCircle className="size-4" />
          {t.lookup.sampleBanner}
        </p>
      )}
    </div>
  );
}

async function Header({
  trackingNumber,
  source,
  checked,
  result,
  status,
}: {
  trackingNumber: string;
  source: string | null;
  checked: string;
  result: LookupResult;
  status?: React.ReactNode;
}) {
  const t = await getT();
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <CarrierChip code={carrierForNumber(trackingNumber)} />
          <h1 className="font-mono text-2xl font-semibold tracking-tight break-all text-zinc-900">
            {trackingNumber}
          </h1>
          <CopyButton value={trackingNumber} label={t.journey.copy} done={t.journey.copied} />
          {status}
        </div>
        {source && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-zinc-600">
            <span className="inline-flex items-center gap-1">
              {result.provider === "4PX" ? (
                <Bolt className="size-4 text-teal-700" />
              ) : (
                <Clock className="size-4 text-zinc-400" />
              )}
              {t.lookup.from(source)}
            </span>
            {result.fetchedAt && <span className="text-zinc-400">·</span>}
            {result.fetchedAt && <span>{checked}</span>}
          </p>
        )}
      </div>
      <form method="get" className="flex gap-2">
        <input type="hidden" name="refresh" value="1" />
        <button className={button.secondary}>
          <Refresh className="size-4" />
          {t.lookup.refresh}
        </button>
      </form>
      {result.shipment && (
        <p className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm text-teal-950">
          {t.lookup.tracked(result.shipment.orderNumber)}
          <Link href={`/shipments/${result.shipment.id}`} className={button.link}>
            {t.lookup.openShipment} →
          </Link>
        </p>
      )}
    </header>
  );
}

async function NotReady({ result, source }: { result: LookupResult; source: string | null }) {
  const t = await getT();
  const provider = source ?? "";
  const content = {
    PENDING: {
      severity: "info" as const,
      title: t.lookup.pendingTitle,
      body: t.lookup.pendingBody(provider),
    },
    NOT_FOUND: {
      severity: "warning" as const,
      title: t.lookup.notFoundTitle,
      body: t.lookup.notFoundBody(provider),
    },
    ERROR: { severity: "critical" as const, title: t.lookup.errorTitle, body: t.lookup.errorBody },
    NO_PROVIDER: {
      severity: "info" as const,
      title: t.lookup.noProviderTitle,
      body: t.lookup.noProviderBody,
    },
  }[result.state as "PENDING" | "NOT_FOUND" | "ERROR" | "NO_PROVIDER"];
  return (
    <div className="space-y-4">
      <Callout
        severity={content.severity}
        label={t.severity[content.severity]}
        title={content.title}
      >
        <p>{content.body}</p>
        {result.state === "ERROR" && result.error && (
          <p className="mt-2 font-mono text-xs break-words text-zinc-600">{result.error}</p>
        )}
      </Callout>
      {(result.state === "NO_PROVIDER" || result.state === "NOT_FOUND") && (
        <p className="flex flex-wrap gap-3 text-sm">
          <Link href="/sources" className={button.secondary}>
            {t.track.connect}
          </Link>
          <Link href={`/track/${SAMPLE_NUMBERS[1]!.trackingNumber}`} className={button.secondary}>
            {t.track.samplesTitle} <ArrowRight className="size-4" />
          </Link>
        </p>
      )}
    </div>
  );
}

async function Journey({
  result,
  now,
  source,
  checked,
}: {
  result: LookupResult;
  now: Date;
  source: string | null;
  checked: string;
}) {
  const t = await getT();
  const prisma = getPrisma();
  const { input, state } = lookupJourney(result, now);
  const benchmarks = await loadBenchmarks(prisma, now);
  const view = viewJourney(input, state, { benchmarks, now });
  const ownEstimate = view.insights.find((i) => i.code === "ESTIMATE");
  const estimate =
    ownEstimate?.code === "ESTIMATE"
      ? ownEstimate.estimate.earliest
      : (result.facts?.estimatedDelivery?.from ?? null);

  // lookupJourney keeps the provider's order after sorting by time, so rows line up one to one.
  const raw = [...result.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const rows = input.events.map((event, i) => ({ event, raw: raw[i]! }));

  return (
    <>
      <Header
        trackingNumber={result.trackingNumber}
        source={source}
        checked={checked}
        result={result}
        status={
          <>
            <StatusBadge status={input.status} />
            {view.stuckSince && <StuckBadge />}
          </>
        }
      />

      <InsightList view={view} />

      <Card className="p-5">
        <Milestones view={view} estimate={estimate} />
      </Card>

      <JourneyFacts view={view} facts={result.facts} estimate={result.facts?.estimatedDelivery} />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title={t.lookup.timelineTitle} description={t.lookup.scans(rows.length)} />
          <LookupTimeline rows={rows} legs={input.legs} />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title={t.journey.stagesTitle} />
            <div className="px-5 py-4">
              {Object.keys(benchmarks.segments).length ? (
                <StageTimes view={view} benchmarks={benchmarks} />
              ) : (
                <p className="text-sm text-zinc-500">{t.journey.notEnoughHistory}</p>
              )}
            </div>
          </Card>
          {result.provider !== "4PX" && (
            <Card className="border-teal-200 bg-teal-50/40 p-5" data-testid="fourpx-pitch">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                <Bolt className="size-4 text-teal-700" />
                {t.lookup.pitchTitle}
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-zinc-700">
                {t.lookup.pitch.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-600" />
                    {line}
                  </li>
                ))}
              </ul>
              <Link href="/sources" className={`${button.link} mt-3 inline-block text-sm`}>
                {t.nav.sources} →
              </Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** Every scan, newest first, grouped by who carried the parcel, with the carrier's own code. */
async function LookupTimeline({
  rows,
  legs,
}: {
  rows: { event: JourneyEvent; raw: AttributedEvent }[];
  legs: { sequence: number; carrierCode: string; trackingNumber: string }[];
}) {
  const t = await getT();
  return (
    <ol>
      {[...legs].reverse().map((leg) => {
        const events = rows.filter((r) => r.event.legSequence === leg.sequence).reverse();
        return (
          <li key={leg.sequence} aria-label={`${t.detail.leg} ${leg.sequence}`}>
            <h3 className="flex flex-wrap items-center gap-2 border-y border-zinc-100 bg-zinc-50/70 px-5 py-2 text-sm font-medium">
              <CarrierChip code={leg.carrierCode} />
              <span className="font-mono text-xs text-zinc-600">{leg.trackingNumber}</span>
            </h3>
            {events.length === 0 ? (
              <p className="px-5 py-3 text-sm text-zinc-500">
                {t.detail.noEvents(leg.carrierCode)}
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {events.map(({ event, raw }, i) => (
                  <li key={i} className="grid grid-cols-[7.5rem_1fr] gap-3 px-5 py-2.5 text-sm">
                    <time
                      className="text-xs text-zinc-500 tabular-nums"
                      dateTime={event.at.toISOString()}
                    >
                      {formatDateTime(event.at)}
                    </time>
                    <div className="min-w-0">
                      <p className="text-zinc-900">{event.message || "—"}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                        {event.stage && (
                          <Pill className="bg-teal-50 text-teal-900">{t.stages[event.stage]}</Pill>
                        )}
                        {event.location && <span>{event.location}</span>}
                        {raw.rawStatus && isFourPxCode(raw.rawStatus) && (
                          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] text-zinc-600">
                            {raw.rawStatus}
                          </code>
                        )}
                        {raw.carrierCode === "4PX" && leg.carrierCode !== "4PX" && (
                          <span className="italic">{t.lookup.reportedBy4px}</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
