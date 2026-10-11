"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Main navigation; the current section is marked for sighted and screen-reader users alike. */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-2.5 pt-1.5 pb-2.5 text-sm whitespace-nowrap transition-colors ${
              active
                ? "border-teal-600 font-medium text-zinc-900"
                : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
