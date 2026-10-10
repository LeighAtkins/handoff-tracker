import Link from "next/link";
import { getT } from "@/lib/i18n";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">{t.states.notFoundTitle}</h1>
      <p className="mt-2 text-zinc-600">{t.states.notFoundHelp}</p>
      <Link href="/shipments" className="mt-4 inline-block underline">
        {t.states.backToShipments}
      </Link>
    </div>
  );
}
