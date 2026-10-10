import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  countExistingOrders,
  type ImportRow,
  type ImportSummary,
  type RowError,
} from "@handoff/app";
import { requireUser } from "@/lib/auth/session";
import { getPrisma } from "@handoff/db";
import { ActionForm } from "@/components/action-form";
import { cancelImportAction, confirmImportAction } from "../actions";

export const metadata: Metadata = { title: "Import preview" };
export const dynamic = "force-dynamic";

const PREVIEW_ROWS = 20;

export default async function ImportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("OPERATOR");
  const { id } = await params;
  const prisma = getPrisma();
  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) notFound();

  const rows = batch.rows as unknown as ImportRow[];
  const errors = batch.errors as unknown as RowError[];
  const summary = batch.summary as unknown as ImportSummary | null;
  const hidden = <input type="hidden" name="batchId" value={batch.id} />;

  return (
    <>
      <p className="text-sm">
        <Link href="/import" className="text-zinc-600 underline">
          ← Import
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">{batch.fileName}</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {batch.shape === "shopify" ? "Shopify export" : "Simple CSV"} · {batch.totalRows} rows
      </p>

      {batch.status === "IMPORTED" && summary && (
        <section
          className="mt-6 rounded border border-emerald-300 bg-emerald-50 p-4 text-sm"
          data-testid="import-result"
        >
          <p className="font-medium">
            {summary.rowsImported} rows imported, {summary.rowsRejected} rejected.
          </p>
          <p className="mt-1">
            {summary.ordersCreated} new orders, {summary.ordersUpdated} updated,{" "}
            {summary.shipmentsCreated} new shipments
            {summary.carriersCreated.length > 0 && (
              <>; new manual-check carriers: {summary.carriersCreated.join(", ")}</>
            )}
            .
          </p>
          <Link href="/shipments" className="mt-2 inline-block underline">
            View shipments
          </Link>
        </section>
      )}

      {batch.status === "CANCELLED" && (
        <p className="mt-6 rounded border border-zinc-300 bg-white p-4 text-sm">
          This import was cancelled. Nothing was imported.
        </p>
      )}

      {batch.status === "PENDING" && (
        <Preview
          rows={rows}
          errors={errors}
          hidden={hidden}
          existing={await countExistingOrders(prisma, rows)}
        />
      )}

      {errors.length > 0 && batch.status !== "PENDING" && <ErrorList errors={errors} />}
    </>
  );
}

function Preview({
  rows,
  errors,
  hidden,
  existing,
}: {
  rows: ImportRow[];
  errors: RowError[];
  hidden: React.ReactNode;
  existing: { existing: number; total: number };
}) {
  return (
    <>
      <section
        className="mt-6 flex flex-wrap items-center gap-6 rounded border border-zinc-200 bg-white p-4"
        data-testid="import-preview"
      >
        <p className="text-sm">
          <strong className="text-lg tabular-nums">{rows.length}</strong> valid rows
          {existing.existing > 0 && (
            <span className="text-zinc-600">
              {" "}
              ({existing.total - existing.existing} new orders, {existing.existing} already known
              and will be updated)
            </span>
          )}
        </p>
        <p className="text-sm">
          <strong className={`text-lg tabular-nums ${errors.length ? "text-red-700" : ""}`}>
            {errors.length}
          </strong>{" "}
          rows with errors (will be skipped)
        </p>
        <div className="ml-auto flex gap-3">
          {rows.length > 0 && (
            <ActionForm
              action={confirmImportAction}
              submitLabel={`Import ${rows.length} valid rows`}
            >
              {hidden}
            </ActionForm>
          )}
          <ActionForm action={cancelImportAction} submitLabel="Cancel" variant="secondary">
            {hidden}
          </ActionForm>
        </div>
      </section>

      {errors.length > 0 && <ErrorList errors={errors} />}

      {rows.length > 0 && (
        <>
          <h2 className="mt-8 font-medium">
            Valid rows{rows.length > PREVIEW_ROWS && ` (first ${PREVIEW_ROWS} of ${rows.length})`}
          </h2>
          <table className="mt-2 w-full bg-white text-left text-sm shadow-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="p-2 font-medium">Row</th>
                <th className="p-2 font-medium">Order</th>
                <th className="p-2 font-medium">Customer</th>
                <th className="p-2 font-medium">Destination</th>
                <th className="p-2 font-medium">Carrier</th>
                <th className="p-2 font-medium">Tracking number</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, PREVIEW_ROWS).map((row) => (
                <tr key={row.row} className="border-b border-zinc-100">
                  <td className="p-2 tabular-nums text-zinc-500">{row.row}</td>
                  <td className="p-2 font-mono">{row.sourceOrderNumber}</td>
                  <td className="p-2">{row.customerName}</td>
                  <td className="p-2">
                    {row.destinationCountry} {row.destinationPostcode}
                  </td>
                  <td className="p-2">{row.carrierCode}</td>
                  <td className="p-2 font-mono text-xs">{row.trackingNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function ErrorList({ errors }: { errors: RowError[] }) {
  return (
    <section className="mt-6" data-testid="import-errors">
      <h2 className="font-medium text-red-800">Rows with errors</h2>
      <ul className="mt-2 space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm">
        {errors.map((e) => (
          <li key={e.row}>
            row {e.row}: {e.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
