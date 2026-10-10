import { Readable } from "node:stream";
import { parse } from "csv-parse";
import { z } from "zod";
import { carrierCodeFor } from "./carriers";

/** One validated row, in the shape the import use case understands, whatever the source file looked like. */
export interface ImportRow {
  row: number;
  sourceSystem: string;
  sourceOrderNumber: string;
  customerName: string;
  destinationCountry: string;
  destinationPostcode: string;
  carrierCode: string;
  trackingNumber: string;
}

export interface RowError {
  row: number;
  message: string;
}

export type CsvShape = "shopify" | "generic";

export interface ParsedImport {
  shape: CsvShape;
  totalRows: number;
  rows: ImportRow[];
  errors: RowError[];
}

/**
 * Column names per shape. Shopify's order export has no tracking columns by default, so the
 * Shopify shape expects "Tracking Number" and "Tracking Company" added (as in its fulfilment CSV).
 */
const SHAPES: Record<
  CsvShape,
  Record<keyof Omit<ImportRow, "row" | "sourceSystem" | "carrierCode">, string> & {
    carrier: string;
  }
> = {
  shopify: {
    sourceOrderNumber: "Name",
    customerName: "Shipping Name",
    destinationCountry: "Shipping Country",
    destinationPostcode: "Shipping Zip",
    trackingNumber: "Tracking Number",
    carrier: "Tracking Company",
  },
  generic: {
    sourceOrderNumber: "order_number",
    customerName: "customer_name",
    destinationCountry: "country",
    destinationPostcode: "postcode",
    trackingNumber: "tracking_number",
    carrier: "carrier",
  },
};

export class CsvFormatError extends Error {
  override name = "CsvFormatError";
}

const required = (what: string) =>
  z
    .string({ error: `missing ${what}` })
    .trim()
    .min(1, `missing ${what}`);

const RowSchema = z.object({
  sourceOrderNumber: required("order number").max(64, "order number is too long"),
  customerName: required("customer name").max(200, "customer name is too long"),
  destinationCountry: required("country")
    .transform((c) => c.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, "country must be a 2-letter code like JP")),
  destinationPostcode: required("postcode").max(16, "postcode is too long"),
  trackingNumber: required("tracking number")
    .transform((t) => t.replace(/\s+/g, ""))
    .pipe(
      z
        .string()
        .regex(/^[A-Za-z0-9-]{4,40}$/, "tracking number should be 4-40 letters, digits or dashes"),
    ),
  carrier: required("carrier").max(64, "carrier is too long"),
});

function detectShape(headers: string[]): CsvShape {
  for (const shape of Object.keys(SHAPES) as CsvShape[]) {
    const needed = Object.values(SHAPES[shape]);
    if (needed.every((h) => headers.includes(h))) return shape;
  }
  const generic = Object.values(SHAPES.generic).join(", ");
  throw new CsvFormatError(
    `Unrecognised columns. Use a Shopify export with "Tracking Number" and "Tracking Company" columns, or these columns: ${generic}`,
  );
}

export const MAX_ROWS = 5000;

/**
 * Parses an export as a stream, validating each row on its own so one bad row never blocks the rest.
 * Rows are numbered as a spreadsheet shows them: the header is row 1.
 * Shopify repeats an order once per line item; repeats of the same order and tracking number are merged.
 */
export async function parseImportCsv(input: Readable | string): Promise<ParsedImport> {
  const stream = typeof input === "string" ? Readable.from([input]) : input;
  const parser = stream.pipe(
    parse({
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }),
  );

  let shape: CsvShape | null = null;
  let totalRows = 0;
  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();

  for await (const record of parser as AsyncIterable<Record<string, string>>) {
    totalRows++;
    const row = totalRows + 1;
    if (totalRows > MAX_ROWS)
      throw new CsvFormatError(
        `Files are limited to ${MAX_ROWS} rows; split it and import in parts`,
      );
    shape ??= detectShape(Object.keys(record));
    const columns = SHAPES[shape];

    // Shopify fills shipping details only on an order's first line-item row; later rows are skippable repeats.
    if (
      shape === "shopify" &&
      !record[columns.trackingNumber] &&
      seen.has(`order:${record[columns.sourceOrderNumber]}`)
    ) {
      continue;
    }

    const result = RowSchema.safeParse(
      Object.fromEntries(
        Object.entries(columns).map(([field, header]) => [field, record[header] || undefined]),
      ),
    );
    if (!result.success) {
      errors.push({ row, message: result.error.issues.map((i) => i.message).join("; ") });
      continue;
    }

    const { carrier, ...fields } = result.data;
    const carrierCode = carrierCodeFor(carrier);
    const key = `${fields.sourceOrderNumber}|${carrierCode}|${fields.trackingNumber}`;
    seen.add(`order:${fields.sourceOrderNumber}`);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ row, sourceSystem: shape, carrierCode, ...fields });
  }

  if (!shape) throw new CsvFormatError("The file has no data rows");
  return { shape, totalRows, rows, errors };
}
