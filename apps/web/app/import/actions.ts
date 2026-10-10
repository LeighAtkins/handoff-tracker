"use server";

import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as app from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { DomainError } from "@handoff/domain";
import { getActor } from "@/lib/actor";

type ActionState = { ok: boolean; message: string } | null;

const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadImportAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: "Choose a CSV file" };
  if (file.size > MAX_BYTES) return { ok: false, message: "Files are limited to 5 MB" };

  let batchId: string;
  try {
    const parsed = await app.parseImportCsv(Readable.fromWeb(file.stream() as NodeReadableStream));
    const batch = await app.createImportBatch(
      getPrisma(),
      { fileName: file.name, parsed },
      await getActor(),
    );
    batchId = batch.id;
  } catch (error) {
    if (error instanceof app.CsvFormatError) return { ok: false, message: error.message };
    if (error instanceof Error && error.name === "CsvError")
      return { ok: false, message: `Could not read the CSV: ${error.message}` };
    throw error;
  }
  redirect(`/import/${batchId}`);
}

export async function confirmImportAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const batchId = String(formData.get("batchId"));
  try {
    await app.confirmImport(getPrisma(), batchId, await getActor());
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(`/import/${batchId}`);
  revalidatePath("/shipments");
  return { ok: true, message: "Imported" };
}

export async function cancelImportAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const batchId = String(formData.get("batchId"));
  try {
    await app.cancelImport(getPrisma(), batchId, await getActor());
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(`/import/${batchId}`);
  return { ok: true, message: "Cancelled" };
}
