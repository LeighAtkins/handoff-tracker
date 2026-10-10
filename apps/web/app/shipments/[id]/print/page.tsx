import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toSVG } from "bwip-js/node";
import { DOCUMENT_TYPES, loadDocument, type DocumentType } from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { DomainError } from "@handoff/domain";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Print" };
export const dynamic = "force-dynamic";

function barcode(text: string): string {
  return toSVG({
    bcid: "code128",
    text,
    height: 14,
    includetext: true,
    textxalign: "center",
    textsize: 10,
  });
}

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const requested = (await searchParams).doc;
  const type: DocumentType = DOCUMENT_TYPES.includes(requested as DocumentType)
    ? (requested as DocumentType)
    : "slip";

  let doc: Awaited<ReturnType<typeof loadDocument>>;
  try {
    doc = await loadDocument(getPrisma(), { shipmentId: id, type }, user.email);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }

  return (
    <>
      {/* Page size per document; browsers use it for "Save as PDF" too. */}
      <style>
        {type === "label"
          ? "@page { size: 100mm 150mm; margin: 0 }"
          : "@page { size: A4; margin: 15mm }"}
      </style>

      <div className="mb-6 flex items-center gap-4 print:hidden">
        <Link href={`/shipments/${id}`} className="text-sm text-zinc-600 underline">
          ← Back
        </Link>
        <nav className="flex gap-3 text-sm">
          <Link
            href={`?doc=slip`}
            className={type === "slip" ? "font-semibold" : "text-zinc-600 underline"}
          >
            Packing slip
          </Link>
          <Link
            href={`?doc=label`}
            className={type === "label" ? "font-semibold" : "text-zinc-600 underline"}
          >
            Parcel label
          </Link>
        </nav>
        <PrintButton label="Print" />
        <p className="text-xs text-zinc-500">
          Shows the customer&rsquo;s name; opening this page is recorded in the audit log.
        </p>
      </div>

      {type === "label" ? (
        <article
          data-testid="label"
          className="mx-auto flex h-[150mm] w-[100mm] flex-col justify-between border border-dashed border-zinc-400 bg-white p-[6mm] text-black print:border-0"
        >
          <header className="flex items-baseline justify-between border-b-2 border-black pb-2">
            <span className="text-sm font-semibold">Comfort Works</span>
            <span className="font-mono text-lg font-bold">{doc.orderNumber}</span>
          </header>
          <section>
            <p className="text-xs uppercase">Deliver to</p>
            <p className="text-xl font-semibold">{doc.customerName}</p>
            <p className="text-lg">
              {doc.destination.postcode} · {doc.destination.country}
            </p>
          </section>
          <section className="text-center">
            <p className="mb-1 text-sm font-semibold">{doc.current.carrier}</p>
            <div
              className="mx-auto w-full [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: barcode(doc.current.trackingNumber) }}
            />
          </section>
          <footer className="text-[10px] text-zinc-700">
            Printed {formatDateTime(new Date())}
          </footer>
        </article>
      ) : (
        <article
          data-testid="slip"
          className="mx-auto max-w-[180mm] bg-white p-8 text-black print:p-0"
        >
          <header className="flex items-start justify-between border-b border-black pb-4">
            <div>
              <h1 className="text-2xl font-semibold">Packing slip</h1>
              <p className="text-sm">Comfort Works</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-xl font-bold">{doc.orderNumber}</p>
              <p className="text-xs">{formatDateTime(new Date())}</p>
            </div>
          </header>
          <section className="mt-6 grid grid-cols-2 gap-6 text-sm">
            <div>
              <h2 className="text-xs uppercase text-zinc-600">Customer</h2>
              <p className="text-base">{doc.customerName}</p>
              <p>
                {doc.destination.postcode}, {doc.destination.country}
              </p>
            </div>
            <div>
              <h2 className="text-xs uppercase text-zinc-600">Order</h2>
              <p>
                {doc.orderNumber} ({doc.sourceSystem})
              </p>
            </div>
          </section>
          <section className="mt-8">
            <h2 className="text-xs uppercase text-zinc-600">Shipment</h2>
            <table className="mt-2 w-full text-left text-sm">
              <thead className="border-b border-black">
                <tr>
                  <th className="py-1">Leg</th>
                  <th className="py-1">Carrier</th>
                  <th className="py-1">Tracking number</th>
                </tr>
              </thead>
              <tbody>
                {doc.legs.map((leg) => (
                  <tr key={leg.sequence} className="border-b border-zinc-300">
                    <td className="py-1">{leg.sequence}</td>
                    <td className="py-1">{leg.carrier}</td>
                    <td className="py-1 font-mono">{leg.trackingNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section
            className="mt-8 w-72 [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: barcode(doc.current.trackingNumber) }}
          />
          <p className="mt-10 text-xs text-zinc-600">
            Questions about this order? Contact Comfort Works customer service with the order number
            above.
          </p>
        </article>
      )}
    </>
  );
}
