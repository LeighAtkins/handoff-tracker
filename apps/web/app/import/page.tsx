import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getPrisma } from "@handoff/db";
import { ActionForm, Field } from "@/components/action-form";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { uploadImportAction } from "./actions";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireUser("OPERATOR");
  const t = await getT();
  const recent = await getPrisma().importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <>
      <h1 className="text-2xl font-semibold">{t.importPage.title}</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section className="rounded border border-zinc-200 bg-white p-5">
          <ActionForm action={uploadImportAction} submitLabel={t.importPage.upload} testId="upload">
            <Field label={t.importPage.file}>
              <input type="file" name="file" accept=".csv,text/csv" required />
            </Field>
          </ActionForm>
          <p className="mt-4 text-sm text-zinc-600">{t.importPage.help}</p>
        </section>

        <aside className="text-sm text-zinc-700">
          <h2 className="font-medium">{t.importPage.formats}</h2>
          <p className="mt-2">
            <strong>Shopify order export</strong> with <code>Tracking Number</code> and{" "}
            <code>Tracking Company</code> columns added.
          </p>
          <p className="mt-2">
            <strong>Simple CSV</strong> with these columns:
          </p>
          <pre className="mt-1 overflow-x-auto rounded bg-zinc-100 p-2 text-xs">
            order_number,customer_name,country,postcode,carrier,tracking_number
          </pre>
          <p className="mt-2">
            Country is a 2-letter code such as JP. Unknown carriers are tracked as manual checks.
          </p>
        </aside>
      </div>

      {recent.length > 0 && (
        <>
          <h2 className="mt-10 font-medium">{t.importPage.recent}</h2>
          <table className="mt-2 w-full bg-white text-left text-sm shadow-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="p-2 font-medium">File</th>
                <th className="p-2 font-medium">Rows</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium">By</th>
                <th className="p-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((batch) => (
                <tr key={batch.id} className="border-b border-zinc-100">
                  <td className="p-2">
                    <Link
                      href={`/import/${batch.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {batch.fileName}
                    </Link>
                  </td>
                  <td className="p-2 tabular-nums">{batch.totalRows}</td>
                  <td className="p-2">{batch.status.toLowerCase()}</td>
                  <td className="p-2">{batch.createdBy}</td>
                  <td className="p-2 text-zinc-600">{formatDateTime(batch.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
