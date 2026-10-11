import { Skeleton } from "@/components/skeleton";
import { getT } from "@/lib/i18n";

export default async function Loading() {
  const t = await getT();
  return <Skeleton rows={8} label={t.states.loading} />;
}
