import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { normaliseTrackingNumber, recentLookups } from "@handoff/app";
import { SAMPLE_NUMBERS, trackingProviders } from "@handoff/carriers";
import { getPrisma } from "@handoff/db";
import { ArrowRight, Bolt, Plug, Search } from "@/components/icons";
import { Card, CardHeader, PageHeader, Pill, button } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatAgo } from "@/lib/format";
import { getAgo, getT } from "@/lib/i18n";

export const metadata: Metadata = { title: "Track a parcel" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ n?: string }>;

const STATE_STYLE: Record<string, string> = {
  READY: "bg-emerald-50 text-emerald-800",
  PENDING: "bg-sky-50 text-sky-800",
  NOT_FOUND: "bg-zinc-100 text-zinc-700",
  ERROR: "bg-red-50 text-red-800",
};

export default async function TrackPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const [t, ago] = await Promise.all([getT(), getAgo()]);
  const { n } = await searchParams;
  const number = n === undefined ? null : normaliseTrackingNumber(n);
  if (number) redirect(`/track/${number}`);
  const invalid = n !== undefined && n.trim() !== "";

  const live = trackingProviders().filter((p) => p.configured);
  const recent = await recentLookups(getPrisma());

  return (
    <div className="space-y-6">
      <PageHeader title={t.track.title} description={t.track.intro} />

      <Card className="p-6">
        <form
          action="/track"
          method="get"
          className="flex flex-col gap-3 sm:flex-row"
          role="search"
        >
          <label className="relative flex-1">
            <span className="sr-only">{t.track.label}</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-zinc-400" />
            <input
              name="n"
              defaultValue={n ?? ""}
              placeholder={t.track.placeholder}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? "track-error" : undefined}
              className="w-full rounded-xl border border-zinc-300 bg-white py-3 pr-3 pl-11 font-mono text-base shadow-sm placeholder:font-sans placeholder:text-zinc-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 focus:outline-none"
            />
          </label>
          <button className={`${button.primary} px-6 py-3 text-base`}>{t.track.submit}</button>
        </form>
        {invalid && (
          <p id="track-error" role="alert" className="mt-2 text-sm text-red-700">
            {t.track.invalid}
          </p>
        )}
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
          {live.length ? (
            <>
              <Bolt className="size-4 text-teal-700" />
              {t.track.liveFrom(live.map((p) => t.lookup.sources[p.name] ?? p.name).join(", "))}
            </>
          ) : (
            <>
              <Plug className="size-4 text-zinc-400" />
              {t.track.noLive}
            </>
          )}
          <Link href="/sources" className={button.link}>
            {t.track.connect}
          </Link>
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title={t.track.samplesTitle} description={t.track.samplesCaption} />
          <ul className="grid gap-px bg-zinc-100 sm:grid-cols-2" data-testid="samples">
            {SAMPLE_NUMBERS.map((sample) => (
              <li key={sample.trackingNumber} className="bg-white">
                <Link
                  href={`/track/${sample.trackingNumber}`}
                  className="group flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-zinc-50"
                >
                  <span>
                    <span className="block text-sm font-medium text-zinc-900">
                      {t.track.scenarios[sample.scenario] ?? sample.scenario}
                    </span>
                    <span className="font-mono text-xs text-zinc-500">{sample.trackingNumber}</span>
                  </span>
                  <ArrowRight className="size-4 text-zinc-300 group-hover:text-teal-700" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title={t.track.recentTitle} />
          {recent.length === 0 ? (
            <p className="px-5 py-4 text-sm text-zinc-500">{t.track.recentNone}</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {recent.map((lookup) => (
                <li key={lookup.trackingNumber}>
                  <Link
                    href={`/track/${lookup.trackingNumber}`}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-zinc-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm">
                        {lookup.trackingNumber}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {t.lookup.sources[lookup.provider] ?? lookup.provider} · {lookup.lookedUpBy}{" "}
                        · {formatAgo(lookup.lookedUpAt, undefined, ago)}
                      </span>
                    </span>
                    <Pill className={STATE_STYLE[lookup.state]}>
                      {t.lookup.states[lookup.state]}
                    </Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
