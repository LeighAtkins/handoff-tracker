import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cancelImport,
  carrierCodeFor,
  confirmImport,
  countExistingOrders,
  createImportBatch,
  CsvFormatError,
  parseImportCsv,
} from "../src";
import { prisma, resetDatabase } from "./helpers";

const actor = "operator@example.com";
const fixture = readFileSync(
  new URL("../../../e2e/fixtures/orders-48-good-2-bad.csv", import.meta.url),
  "utf8",
);

const shopifyCsv = [
  "Name,Email,Lineitem name,Shipping Name,Shipping Zip,Shipping Country,Tracking Company,Tracking Number",
  "#1001,a@example.com,Sofa cover,Aiko Tanaka,150-0001,JP,4PX,4PX3000000001CN",
  "#1001,a@example.com,Cushion cover,,,,,",
  "#1002,b@example.com,Sofa cover,Kenji Suzuki,530-0001,jp,佐川急便,900011112222",
].join("\n");

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("parseImportCsv", () => {
  it("reports bad rows by spreadsheet row number and keeps the rest", async () => {
    const parsed = await parseImportCsv(fixture);
    expect(parsed.shape).toBe("generic");
    expect(parsed.totalRows).toBe(50);
    expect(parsed.rows).toHaveLength(48);
    expect(parsed.errors).toEqual([
      { row: 14, message: "missing tracking number" },
      { row: 37, message: "country must be a 2-letter code like JP" },
    ]);
  });

  it("parses a stream", async () => {
    expect((await parseImportCsv(Readable.from([fixture]))).rows).toHaveLength(48);
  });

  it("reads the Shopify shape, merging line-item repeats and mapping carrier names", async () => {
    const parsed = await parseImportCsv(shopifyCsv);
    expect(parsed.shape).toBe("shopify");
    expect(
      parsed.rows.map((r) => [r.sourceOrderNumber, r.carrierCode, r.destinationCountry]),
    ).toEqual([
      ["#1001", "4PX", "JP"],
      ["#1002", "SAGAWA", "JP"],
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it("drops exact duplicate rows", async () => {
    const csv =
      "order_number,customer_name,country,postcode,carrier,tracking_number\nA1,X,JP,1,4PX,ABCD1234\nA1,X,JP,1,4px,ABCD 1234\n";
    expect((await parseImportCsv(csv)).rows).toHaveLength(1);
  });

  it("rejects files with unknown columns or no rows", async () => {
    await expect(parseImportCsv("foo,bar\n1,2\n")).rejects.toThrow(CsvFormatError);
    await expect(parseImportCsv("order_number,customer_name\n")).rejects.toThrow("no data rows");
  });

  it("lists every problem on a row", async () => {
    const csv =
      "order_number,customer_name,country,postcode,carrier,tracking_number\n,X,JPN,1,4PX,!!\n";
    expect((await parseImportCsv(csv)).errors[0]?.message).toBe(
      "missing order number; country must be a 2-letter code like JP; tracking number should be 4-40 letters, digits or dashes",
    );
  });
});

describe("carrierCodeFor", () => {
  it("maps aliases and slugs unknown names", () => {
    expect(carrierCodeFor(" Sagawa  Express ")).toBe("SAGAWA");
    expect(carrierCodeFor("4PX Worldwide")).toBe("4PX");
    expect(carrierCodeFor("Seino Transport")).toBe("SEINO_TRANSPORT");
  });

  it("reads NOMS forwarder:channel values", () => {
    expect(carrierCodeFor("4px:S5058")).toBe("4PX");
    expect(carrierCodeFor("takesend:SAGAWA")).toBe("SAGAWA");
    expect(carrierCodeFor("takesend")).toBe("TAKESEND");
    expect(carrierCodeFor("acme:X1")).toBe("ACME");
  });
});

describe("confirmImport", () => {
  async function importCsv(csv: string, fileName = "orders.csv") {
    const batch = await createImportBatch(
      prisma,
      { fileName, parsed: await parseImportCsv(csv) },
      actor,
    );
    return { batch, summary: await confirmImport(prisma, batch.id, actor) };
  }

  it("creates orders and Leg 1 shipments, and audits the import", async () => {
    const { batch, summary } = await importCsv(fixture);
    expect(summary).toMatchObject({
      ordersCreated: 48,
      ordersUpdated: 0,
      shipmentsCreated: 48,
      rowsImported: 48,
      rowsRejected: 2,
    });
    expect(await prisma.leg.count({ where: { sequence: 1 } })).toBe(48);
    expect(await prisma.shipment.count({ where: { status: "PENDING" } })).toBe(48);

    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: batch.id } });
    expect(audit).toMatchObject({ action: "IMPORT_COMPLETED", actor });
    expect(audit.after).toMatchObject({
      rowsImported: 48,
      rowsRejected: 2,
      fileName: "orders.csv",
    });
  });

  it("is idempotent: re-importing updates orders and never duplicates", async () => {
    await importCsv(fixture);
    const { summary } = await importCsv(fixture.replace("Aiko Tanaka", "Aiko Tanaka-Smith"));
    expect(summary).toMatchObject({ ordersCreated: 0, ordersUpdated: 48, shipmentsCreated: 0 });
    expect(await prisma.order.count()).toBe(48);
    expect(await prisma.shipment.count()).toBe(48);
    expect(
      await prisma.order.count({ where: { customerName: "Aiko Tanaka-Smith" } }),
    ).toBeGreaterThan(0);
  });

  it("adds a shipment when an existing order gets a new tracking number", async () => {
    await importCsv(shopifyCsv);
    const { summary } = await importCsv(shopifyCsv.replace("4PX3000000001CN", "4PX3000000099CN"));
    expect(summary.shipmentsCreated).toBe(1);
    expect(await prisma.shipment.count()).toBe(3);
  });

  it("creates unknown carriers as manual-check carriers", async () => {
    const csv =
      "order_number,customer_name,country,postcode,carrier,tracking_number\nZ1,X,JP,1,Seino,SEINO12345\n";
    const { summary } = await importCsv(csv);
    expect(summary.carriersCreated).toEqual(["SEINO"]);
    expect(await prisma.carrier.findUnique({ where: { code: "SEINO" } })).toMatchObject({
      adapter: "manual",
    });
  });

  it("can only be confirmed or cancelled once", async () => {
    const { batch } = await importCsv(fixture);
    await expect(confirmImport(prisma, batch.id, actor)).rejects.toThrow("already imported");
    await expect(cancelImport(prisma, batch.id, actor)).rejects.toThrow("already imported");
    await expect(confirmImport(prisma, "nope", actor)).rejects.toThrow("not found");
  });

  it("cancelling imports nothing", async () => {
    const batch = await createImportBatch(
      prisma,
      { fileName: "x.csv", parsed: await parseImportCsv(fixture) },
      actor,
    );
    await cancelImport(prisma, batch.id, actor);
    expect(await prisma.order.count()).toBe(0);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe(
      "CANCELLED",
    );
  });

  it("counts orders that already exist for the preview, per source system", async () => {
    await importCsv(fixture);
    const parsed = await parseImportCsv(fixture + "#1001,X,JP,1,4PX,ABCD1234\n");
    expect(await countExistingOrders(prisma, parsed.rows)).toEqual({ existing: 48, total: 49 });
    // The same order number from Shopify is a different order.
    expect(await countExistingOrders(prisma, (await parseImportCsv(shopifyCsv)).rows)).toEqual({
      existing: 0,
      total: 2,
    });
  });
});
