import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
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
    { href: "/stuck", label: t.nav.stuck },
    { href: "/shipments", label: t.nav.shipments },
    ...(user && user.role !== "VIEWER" ? [{ href: "/import", label: t.nav.import }] : []),
    { href: "/metrics", label: t.nav.metrics },
    ...(user?.role === "ADMIN" ? [{ href: "/admin/users", label: t.nav.users }] : []),
  ];

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <header className="border-b border-zinc-200 bg-white print:hidden">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-6 py-3 text-sm">
            <Link href="/" className="font-semibold">
              Handoff Tracker
            </Link>
            {user &&
              nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-zinc-600 hover:text-zinc-900"
                >
                  {item.label}
                </Link>
              ))}
            <div className="ml-auto flex items-center gap-4">
              <form action={setLocaleAction} className="flex gap-1" aria-label={t.language}>
                {(["en", "ja"] as const).map((l) => (
                  <button
                    key={l}
                    name="locale"
                    value={l}
                    aria-pressed={locale === l}
                    className={locale === l ? "font-semibold" : "text-zinc-500 hover:text-zinc-900"}
                  >
                    {l === "en" ? "EN" : "日本語"}
                  </button>
                ))}
              </form>
              {user && (
                <form action="/auth/signout" method="post" className="flex items-center gap-3">
                  <span className="text-zinc-500">
                    {user.email} · {user.role.toLowerCase()}
                  </span>
                  <button className="text-zinc-600 underline">{t.nav.signOut}</button>
                </form>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8 print:max-w-none print:p-0">{children}</main>
      </body>
    </html>
  );
}
