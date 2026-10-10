import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Handoff Tracker", template: "%s · Handoff Tracker" },
  description: "Follow parcels across carrier handoffs and flag shipments that go quiet.",
};

const NAV = [
  { href: "/stuck", label: "Stuck" },
  { href: "/shipments", label: "Shipments" },
  { href: "/import", label: "Import" },
  { href: "/metrics", label: "Metrics" },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <header className="border-b border-zinc-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3 text-sm">
            <Link href="/" className="font-semibold">
              Handoff Tracker
            </Link>
            {user &&
              NAV.filter((item) => item.href !== "/import" || user.role !== "VIEWER").map(
                (item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-zinc-600 hover:text-zinc-900"
                  >
                    {item.label}
                  </Link>
                ),
              )}
            {user?.role === "ADMIN" && (
              <Link href="/admin/users" className="text-zinc-600 hover:text-zinc-900">
                Users
              </Link>
            )}
            {user && (
              <form
                action="/auth/signout"
                method="post"
                className="ml-auto flex items-center gap-3"
              >
                <span className="text-zinc-500">
                  {user.email} · {user.role.toLowerCase()}
                </span>
                <button className="text-zinc-600 underline">Sign out</button>
              </form>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
