import type { Metadata } from "next";
import Link from "next/link";
import { trackingProviders } from "@handoff/carriers";
import { Bolt, CheckCircle, Plug } from "@/components/icons";
import { Card, CardHeader, PageHeader, Pill, button } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = { title: "Data sources" };
export const dynamic = "force-dynamic";

/**
 * Where tracking data comes from and what connecting 4PX directly would change. It shows which
 * keys are set (never their values), so it is safe for every signed-in user.
 */
export default async function SourcesPage() {
  await requireUser();
  const t = await getT();
  const providers = trackingProviders();
  const fourPx = providers.find((p) => p.name === "4PX")!;

  return (
    <div className="space-y-6">
      <PageHeader title={t.sources.title} description={t.sources.intro} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="providers">
        {providers.map((provider) => (
          <Card
            key={provider.name}
            className={`flex flex-col p-5 ${provider.name === "4PX" ? "border-teal-300 ring-1 ring-teal-200" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">
                  {t.lookup.sources[provider.name] ?? provider.name}
                </h2>
                <p className="text-xs text-zinc-500">
                  {provider.name === "4PX" ? t.sources.direct : t.sources.aggregator}
                </p>
              </div>
              {provider.configured ? (
                <Pill className="bg-emerald-50 text-emerald-800">
                  <CheckCircle className="size-3.5" />
                  {t.sources.connected}
                </Pill>
              ) : (
                <Pill className="bg-zinc-100 text-zinc-600">
                  <Plug className="size-3.5" />
                  {t.sources.notConnected}
                </Pill>
              )}
            </div>
            <p className="mt-3 text-sm text-zinc-700">{t.sources.summaries[provider.name]}</p>
            {!provider.configured && (
              <p className="mt-auto pt-3 text-xs text-zinc-500">
                {t.sources.setIn(provider.keys.join(" + "))}
              </p>
            )}
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader title={t.sources.compareTitle} description={t.sources.compareCaption} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="compare">
            <thead className="text-xs text-zinc-500">
              <tr className="border-b border-zinc-100">
                <th className="px-5 py-2.5 font-medium">{t.sources.feature}</th>
                <th className="px-5 py-2.5 font-medium">{t.sources.today}</th>
                <th className="px-5 py-2.5 font-medium">{t.sources.viaAggregator}</th>
                <th className="bg-teal-50/60 px-5 py-2.5 font-semibold text-teal-900">
                  {t.sources.viaFourPx}
                </th>
              </tr>
            </thead>
            <tbody>
              {t.sources.rows.map(([feature, today, aggregator, fourPxCell]) => (
                <tr key={feature} className="border-b border-zinc-100 last:border-0 align-top">
                  <th scope="row" className="px-5 py-3 font-medium text-zinc-900">
                    {feature}
                  </th>
                  <td className="px-5 py-3 text-zinc-600">{today}</td>
                  <td className="px-5 py-3 text-zinc-600">{aggregator}</td>
                  <td className="bg-teal-50/60 px-5 py-3 font-medium text-teal-950">
                    {fourPxCell}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <Bolt className="size-4 text-teal-700" />
            {t.sources.whyTitle}
          </h2>
          <ol className="mt-3 space-y-3 text-sm text-zinc-700">
            {t.sources.why.map((reason, i) => (
              <li key={reason} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-semibold text-teal-800">
                  {i + 1}
                </span>
                <span>{reason}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-zinc-900">{t.sources.stepsTitle}</h2>
          <ol className="mt-3 space-y-2.5 text-sm text-zinc-700">
            {t.sources.steps.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="w-5 shrink-0 font-semibold text-zinc-400 tabular-nums">
                  {i + 1}.
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <h3 className="mt-5 text-sm font-semibold text-zinc-900">{t.sources.askTitle}</h3>
          <blockquote className="mt-2 rounded-lg border-l-4 border-teal-500 bg-zinc-50 px-4 py-3 text-sm text-zinc-800">
            {t.sources.ask}
          </blockquote>
          <p className="mt-3 text-xs text-zinc-500">{t.sources.caveat}</p>
        </Card>
      </div>

      <p className="flex flex-wrap items-center gap-3 text-sm text-zinc-600">
        {t.sources.writeUp}
        {!fourPx.configured && (
          <Link href="/track/4PXDEMO1005CN" className={button.secondary}>
            {t.track.samplesTitle}: {t.track.scenarios["in-flight"]}
          </Link>
        )}
      </p>
    </div>
  );
}
