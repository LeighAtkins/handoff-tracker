import { createShipment, DomainError } from "@handoff/domain";
import type { PrismaClient } from "@handoff/db";
import { refresh } from "../refresh";
import { writeAudit, type Actor } from "../audit";
import type { ImportRow, ParsedImport, RowError } from "./parse";

export interface ImportSummary {
  ordersCreated: number;
  ordersUpdated: number;
  shipmentsCreated: number;
  rowsImported: number;
  rowsRejected: number;
  carriersCreated: string[];
}

/** Stores a parsed file for the operator to preview. Nothing is imported yet. */
export async function createImportBatch(
  prisma: PrismaClient,
  input: { fileName: string; parsed: ParsedImport },
  actor: Actor,
) {
  return prisma.importBatch.create({
    data: {
      fileName: input.fileName.slice(0, 200),
      shape: input.parsed.shape,
      totalRows: input.parsed.totalRows,
      rows: input.parsed.rows as never,
      errors: input.parsed.errors as never,
      createdBy: actor,
    },
  });
}

/** For the preview: how many of the valid rows refer to orders that already exist. */
export async function countExistingOrders(prisma: PrismaClient, rows: ImportRow[]) {
  const keys = [...new Set(rows.map((r) => `${r.sourceSystem}|${r.sourceOrderNumber}`))];
  if (keys.length === 0) return { existing: 0, total: 0 };
  const existing = await prisma.order.count({
    where: {
      OR: keys.map((key) => {
        const [sourceSystem, sourceOrderNumber] = key.split("|") as [string, string];
        return { sourceSystem, sourceOrderNumber };
      }),
    },
  });
  return { existing, total: keys.length };
}

/**
 * Imports the valid rows of a previewed batch. Re-importing the same order updates it and never
 * duplicates it; a tracking number the order already has is not added again. Unknown carriers
 * are created as manual-check carriers (P2: no scraping).
 */
export async function confirmImport(
  prisma: PrismaClient,
  batchId: string,
  actor: Actor,
  now = new Date(),
) {
  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new DomainError("Import not found");
      if (batch.status !== "PENDING")
        throw new DomainError(`This import was already ${batch.status.toLowerCase()}`);
      const rows = batch.rows as unknown as ImportRow[];
      const errors = batch.errors as unknown as RowError[];

      const summary: ImportSummary = {
        ordersCreated: 0,
        ordersUpdated: 0,
        shipmentsCreated: 0,
        rowsImported: rows.length,
        rowsRejected: errors.length,
        carriersCreated: [],
      };

      const knownCarriers = new Set(
        (await tx.carrier.findMany({ select: { code: true } })).map((c) => c.code),
      );
      for (const code of new Set(rows.map((r) => r.carrierCode))) {
        if (knownCarriers.has(code)) continue;
        await tx.carrier.create({ data: { code, name: code, adapter: "manual" } });
        summary.carriersCreated.push(code);
      }

      for (const row of rows) {
        const details = {
          customerName: row.customerName,
          destinationCountry: row.destinationCountry,
          destinationPostcode: row.destinationPostcode,
        };
        const where = {
          sourceSystem_sourceOrderNumber: {
            sourceSystem: row.sourceSystem,
            sourceOrderNumber: row.sourceOrderNumber,
          },
        };
        const existing = await tx.order.findUnique({
          where,
          include: { shipments: { include: { legs: true } } },
        });
        const order = existing
          ? await tx.order.update({ where: { id: existing.id }, data: details })
          : await tx.order.create({
              data: {
                ...details,
                sourceSystem: row.sourceSystem,
                sourceOrderNumber: row.sourceOrderNumber,
              },
            });
        if (existing) summary.ordersUpdated++;
        else summary.ordersCreated++;

        const alreadyTracked = existing?.shipments.some((s) =>
          s.legs.some(
            (l) => l.carrierCode === row.carrierCode && l.trackingNumber === row.trackingNumber,
          ),
        );
        if (alreadyTracked) continue;

        const state = createShipment({
          createdAt: now,
          carrierCode: row.carrierCode,
          trackingNumber: row.trackingNumber,
        });
        const leg = state.legs[0]!;
        const shipment = await tx.shipment.create({
          data: {
            orderId: order.id,
            createdAt: now,
            legs: {
              create: {
                sequence: leg.sequence,
                carrierCode: leg.carrierCode,
                trackingNumber: leg.trackingNumber,
                startedAt: leg.startedAt,
              },
            },
          },
        });
        await refresh(tx, shipment.id, now, actor);
        summary.shipmentsCreated++;
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: "IMPORTED", summary: summary as never, completedAt: now },
      });
      await writeAudit(tx, {
        entityType: "Import",
        entityId: batchId,
        action: "IMPORT_COMPLETED",
        actor,
        after: {
          fileName: batch.fileName,
          shape: batch.shape,
          totalRows: batch.totalRows,
          ...summary,
        },
      });
      return summary;
    },
    { timeout: 60_000 },
  );
}

export async function cancelImport(
  prisma: PrismaClient,
  batchId: string,
  actor: Actor,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new DomainError("Import not found");
    if (batch.status !== "PENDING")
      throw new DomainError(`This import was already ${batch.status.toLowerCase()}`);
    await tx.importBatch.update({
      where: { id: batchId },
      data: { status: "CANCELLED", completedAt: now },
    });
    await writeAudit(tx, {
      entityType: "Import",
      entityId: batchId,
      action: "IMPORT_CANCELLED",
      actor,
      after: { fileName: batch.fileName, totalRows: batch.totalRows },
    });
  });
}
