import type { Metadata } from "next";
import Link from "next/link";
import { overview, PIPELINE } from "@handoff/app";
import { SEGMENTS } from "@handoff/domain";
import { getPrisma } from "@handoff/db";
import { BarList, ChartCard, Columns, LineChart, RangeBars, Sparkline } from "@/components/charts";
import { AlertOctagon, ArrowRight, Clock, Handoff, Package } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardHeader,
  CarrierChip,
  PageHeader,
  SeverityIcon,
  StatTile,
  button,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatAgo, formatDate, formatDateTime, formatDuration, formatPercent } from "@/lib/format";
import { getAgo, getT } from "@/lib/i18n";
import { describeInsight } from "@/lib/insights";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const num = (value: string | undefined, fallback: number) =>
  value && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export default async function OverviewPage() {
  await requireUser();
  const [t, ago] = await Promise.all([getT(), getAgo()]);
  const now = new Date();
  const o = await overview(getPrisma(), {
    now,
    targetDays: num(process.env.DELIVERY_TARGET_DAYS, 7),
  });
  const tracked = await getPrisma().shipment.count();
  const duration = (hours: number) => formatDuration(hours, t.duration);
  const days = (value: number) => t.duration.days(value.toFixed(1));
  const problems = o.openProblems.reduce((n, p) => n + p.count, 0);
  const needAttention = o.attention.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.overview.title}
        description={t.overview.subtitle(tracked, formatDateTime(now))}
        actions={
          <Link href="/track" className={button.primary}>
            {t.track.title}
            <ArrowRight className="size-4" />
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="kpis">
        <StatTile
          label={t.overview.open}
          icon={<Package className="size-4 text-zinc-400" />}
          value={o.open}
          note={t.overview.openNote}
        />
        <StatTile
          label={t.overview.attention}
          icon={<AlertOctagon className="size-4 text-red-600" title={t.severity.critical} />}
          tone={needAttention ? "critical" : "neutral"}
          value={needAttention}
          note={t.overview.attentionNote(o.stuck, problems)}
        >
          <Link href="/stuck" className={`${button.link} text-xs`}>
            {t.nav.stuck} →
          </Link>
        </StatTile>
        <StatTile
          label={t.overview.doorToDoor}
          icon={<Clock className="size-4 text-zinc-400" />}
          value={o.delivered.medianDays === null ? "—" : days(o.delivered.medianDays)}
          note={
            o.delivered.p80Days === null
              ? t.overview.noData
              : t.overview.doorToDoorNote(days(o.delivered.p80Days))
          }
        >
          <Sparkline values={o.weekly.map((w) => w.medianDays)} />
        </StatTile>
        <StatTile
          label={t.overview.onTarget(o.targetDays)}
          value={o.delivered.withinTarget === null ? "—" : formatPercent(o.delivered.withinTarget)}
          note={t.overview.onTargetNote(o.delivered.count, o.periodDays)}
        />
        <StatTile
          label={t.overview.handoff}
          icon={<Handoff className="size-4 text-violet-600" />}
          value={o.handoff.medianHours === null ? "—" : duration(o.handoff.medianHours)}
          note={
            o.handoff.within24h === null
              ? t.overview.noData
              : t.overview.handoffNote(formatPercent(o.handoff.within24h))
          }
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t.overview.pipelineTitle}
          caption={t.overview.pipelineCaption}
          legend={[
            { label: t.overview.onTrack, color: "#0d9488" },
            { label: t.overview.withProblem, color: "#d03b3b" },
          ]}
          tableLabel={t.charts.showTable}
          table={{
            head: ["", t.overview.onTrack, t.overview.withProblem],
            rows: o.pipeline.map((p) => [
              t.pipeline[p.stage],
              p.count - p.withProblem,
              p.withProblem,
            ]),
          }}
        >
          <BarList
            rows={PIPELINE.map((stage) => {
              const row = o.pipeline.find((p) => p.stage === stage)!;
              return {
                label: t.pipeline[stage],
                base: row.count - row.withProblem,
                flagged: row.withProblem,
              };
            })}
            baseLabel={t.overview.onTrack}
            flagLabel={t.overview.withProblem}
            valueLabel={t.charts.parcels}
          />
        </ChartCard>

        <ChartCard
          title={t.overview.gapTitle}
          caption={t.overview.gapCaption(o.handoff.samples)}
          tableLabel={t.charts.showTable}
          table={{
            head: [t.overview.gapBucket, t.charts.count],
            rows: o.handoff.buckets.map((b) => [b.label, b.count]),
          }}
        >
          <Columns
            columns={o.handoff.buckets.map((b, i) => ({
              label: b.label,
              value: b.count,
              tip: `${t.overview.gapBucket} ${b.label}`,
              highlight: i >= 3,
            }))}
            valueLabel={t.charts.parcels}
          />
        </ChartCard>

        <ChartCard
          title={t.overview.segmentsTitle}
          caption={t.overview.segmentsCaption}
          legend={[
            { label: t.overview.median, color: "#0f766e" },
            { label: t.overview.p80, color: "#14b8a6" },
          ]}
          tableLabel={t.charts.showTable}
          table={{
            head: ["", t.overview.median, t.overview.p80],
            rows: o.segments.map((s) => [
              t.segments[s.key],
              duration(s.medianHours),
              duration(s.p80Hours),
            ]),
          }}
        >
          <RangeBars
            rows={SEGMENTS.flatMap(({ key }) => {
              const s = o.segments.find((x) => x.key === key);
              return s
                ? [
                    {
                      label: t.segments[key],
                      median: s.medianHours,
                      p80: s.p80Hours,
                      emphasis: key === "HANDOFF",
                    },
                  ]
                : [];
            })}
            format={duration}
            medianLabel={t.overview.median}
            p80Label={t.overview.p80}
          />
        </ChartCard>

        <div className="grid gap-6">
          <ChartCard
            title={t.overview.trendTitle}
            caption={t.overview.trendCaption(o.targetDays)}
            tableLabel={t.charts.showTable}
            table={{
              head: ["", t.overview.doorToDoor, t.overview.weeklyTitle],
              rows: o.weekly.map((w) => [
                t.overview.weekTo(formatDate(w.to)),
                w.medianDays === null ? "—" : days(w.medianDays),
                w.delivered,
              ]),
            }}
          >
            <LineChart
              points={o.weekly.map((w) => ({
                label: formatDate(w.to),
                value: w.medianDays,
                tip: `${t.overview.weekTo(formatDate(w.to))} · ${t.charts.parcels(w.delivered)}`,
              }))}
              target={o.targetDays}
              targetLabel={t.overview.target(o.targetDays)}
              format={days}
              height={150}
            />
          </ChartCard>
          <ChartCard
            title={t.overview.weeklyTitle}
            caption={t.overview.weeklyCaption}
            tableLabel={t.charts.showTable}
            table={{
              head: ["", t.overview.weeklyTitle],
              rows: o.weekly.map((w) => [t.overview.weekTo(formatDate(w.to)), w.delivered]),
            }}
          >
            <Columns
              height={130}
              columns={o.weekly.map((w) => ({
                label: formatDate(w.to),
                value: w.delivered,
                tip: t.overview.weekTo(formatDate(w.to)),
              }))}
              valueLabel={t.charts.parcels}
            />
          </ChartCard>
        </div>
      </div>

      <Card>
        <CardHeader
          title={t.overview.attentionTitle}
          description={t.overview.attentionCaption}
          actions={
            <Link href="/stuck" className={`${button.link} text-sm`}>
              {t.nav.stuck} →
            </Link>
          }
        />
        {o.attention.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-600">{t.overview.attentionNone}</p>
        ) : (
          <ul className="divide-y divide-zinc-100" data-testid="attention">
            {o.attention.slice(0, 8).map((item) => {
              const text = describeInsight(item.insight, {
                t,
                trackingNumber: item.trackingNumber,
                quietDays: item.lastEventAt
                  ? Math.floor((now.getTime() - item.lastEventAt.getTime()) / 86_400_000)
                  : 0,
                lastMileCarrier: item.carrierCode === "4PX" ? null : item.carrierCode,
              });
              return (
                <li key={item.shipmentId}>
                  <Link
                    href={`/shipments/${item.shipmentId}`}
                    className="grid gap-x-4 gap-y-1 px-5 py-3 hover:bg-zinc-50 sm:grid-cols-[8rem_1fr_auto]"
                  >
                    <span className="flex items-center gap-2 font-mono text-sm font-medium">
                      <SeverityIcon
                        severity={item.insight.severity}
                        label={t.severity[item.insight.severity]}
                      />
                      {item.orderNumber}
                    </span>
                    <span className="min-w-0 text-sm">
                      <span className="font-medium text-zinc-900">{text.title}</span>
                      {text.action && (
                        <span className="block truncate text-zinc-600">{text.action}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-zinc-500 sm:justify-end">
                      <StatusBadge status={item.status} />
                      <CarrierChip code={item.carrierCode} />
                      <span>{formatAgo(item.lastEventAt, now, ago)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
        <h2 className="font-semibold text-zinc-900">{t.overview.howTitle}</h2>
        <p className="mt-2 leading-relaxed">{t.overview.howBody}</p>
      </section>
    </div>
  );
}
