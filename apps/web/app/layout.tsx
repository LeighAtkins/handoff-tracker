import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "@/components/icons";
import { NavLinks } from "@/components/nav-links";
import { getSessionUser } from "@/lib/auth/session";
import { getLocale, getT } from "@/lib/i18n";
import { setLocaleAction } from "@/lib/i18n/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Handoff Tracker", template: "%s · Handoff Tracker" },
  description: "Follow parcels across carrier handoffs and flag shipments that go quiet.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [user, locale, t] = await Promise.all([getSessionUser(), getLocale(), getT()]);
  const nav = [
    { href: "/overview", label: t.nav.overview },
    { href: "/track", label: t.nav.track },
    { href: "/stuck", label: t.nav.stuck },
    { href: "/shipments", label: t.nav.shipments },
    ...(user && user.role !== "VIEWER" ? [{ href: "/import", label: t.nav.import }] : []),
    { href: "/metrics", label: t.nav.metrics },
    { href: "/sources", label: t.nav.sources },
    ...(user?.role === "ADMIN" ? [{ href: "/admin/users", label: t.nav.users }] : []),
  ];

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 pt-2.5 pb-2">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
            >
              <svg viewBox="0 0 64 64" className="size-7" aria-hidden>
                <rect width="64" height="64" rx="14" fill="#0d9488" />
                <text
                  x="32"
                  y="32"
                  dy="0.35em"
                  textAnchor="middle"
                  fontSize="26"
                  fontWeight="600"
                  fill="#fff"
                  fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
                >
                  HT
                </text>
              </svg>
              Handoff Tracker
            </Link>
            {user && (
              <form
                action="/track"
                method="get"
                role="search"
                className="relative ml-4 hidden w-full max-w-sm md:block"
              >
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
                <input
                  name="n"
                  aria-label={t.quickTrack.label}
                  placeholder={t.quickTrack.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 py-1.5 pr-2 pl-8 text-sm placeholder:text-zinc-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/20 focus:outline-none"
                />
              </form>
            )}
            <div className="ml-auto flex items-center gap-3 text-sm">
              <form action={setLocaleAction} className="flex gap-1" aria-label={t.language}>
                {(["en", "ja"] as const).map((l) => (
                  <button
                    key={l}
                    name="locale"
                    value={l}
                    aria-pressed={locale === l}
                    className={`rounded px-1.5 py-0.5 ${locale === l ? "bg-zinc-100 font-semibold text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}
                  >
                    {l === "en" ? "EN" : "日本語"}
                  </button>
                ))}
              </form>
              {user && (
                <form action="/auth/signout" method="post" className="flex items-center gap-3">
                  <span className="text-zinc-500" title={user.role.toLowerCase()}>
                    {user.email}
                  </span>
                  <button className="text-zinc-600 hover:text-zinc-900">{t.nav.signOut}</button>
                </form>
              )}
            </div>
          </div>
          {user && (
            <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4" aria-label="Main">
              <NavLinks items={nav} />
            </nav>
          )}
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8 print:max-w-none print:p-0">{children}</main>
      </body>
    </html>
  );
}
