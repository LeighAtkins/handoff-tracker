"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as app from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { DomainError, STATUSES } from "@handoff/domain";
import { getActor } from "@/lib/actor";
import { NotAllowedError } from "@/lib/auth/session";
import { parseZonedDateTime } from "@/lib/format";

export type ActionState = { ok: boolean; message: string } | null;

const id = z.string().min(1);
const dateTime = z.string().transform((value, ctx) => {
  const date = parseZonedDateTime(value);
  if (!date) {
    ctx.addIssue({ code: "custom", message: "Enter a date and time" });
    return z.NEVER;
  }
  return date;
});

/** Validates the form, runs the use case, and turns domain errors into messages for the operator. */
async function run<T extends z.ZodType>(
  schema: T,
  formData: FormData,
  useCase: (input: z.infer<T>, actor: string) => Promise<unknown>,
  success: string,
): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form" };
  try {
    await useCase(parsed.data, await getActor());
  } catch (error) {
    if (error instanceof DomainError || error instanceof NotAllowedError)
      return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(`/shipments/${(parsed.data as { shipmentId: string }).shipmentId}`);
  revalidatePath("/stuck");
  revalidatePath("/shipments");
  return { ok: true, message: success };
}

const manualEventSchema = z.object({
  shipmentId: id,
  legSequence: z.coerce.number().int().min(1),
  occurredAt: dateTime,
  message: z.string().trim().min(1, "Describe what the carrier said").max(500),
  location: z.string().trim().max(200).optional(),
  status: z.enum([...STATUSES, ""]).transform((s) => (s === "" ? null : s)),
});

export async function addManualEventAction(_: ActionState, formData: FormData) {
  return run(
    manualEventSchema,
    formData,
    (input, actor) =>
      app.addManualEvent(getPrisma(), { ...input, location: input.location || null }, actor),
    "Event added",
  );
}

export async function addNoteAction(_: ActionState, formData: FormData) {
  return run(
    z.object({
      shipmentId: id,
      text: z.string().trim().min(1, "A note cannot be empty").max(2000),
    }),
    formData,
    (input, actor) => app.addNote(getPrisma(), input, actor),
    "Note added",
  );
}

export async function overrideStatusAction(_: ActionState, formData: FormData) {
  return run(
    z.object({
      shipmentId: id,
      status: z.enum(STATUSES),
      reason: z.string().trim().min(1, "Give a reason for the override"),
    }),
    formData,
    (input, actor) => app.overrideStatus(getPrisma(), input, actor),
    "Status overridden",
  );
}

export async function clearOverrideAction(_: ActionState, formData: FormData) {
  return run(
    z.object({ shipmentId: id }),
    formData,
    (input, actor) => app.clearOverride(getPrisma(), input, actor),
    "Override cleared",
  );
}

export async function markResolvedAction(_: ActionState, formData: FormData) {
  return run(
    z.object({ shipmentId: id }),
    formData,
    (input, actor) => app.markResolved(getPrisma(), input, actor),
    "Marked resolved",
  );
}

export async function recordHandoffAction(_: ActionState, formData: FormData) {
  return run(
    z.object({
      shipmentId: id,
      carrierCode: z.string().min(1, "Choose the next carrier"),
      trackingNumber: z.string().trim().min(1, "Enter the next carrier's tracking number").max(64),
      at: dateTime,
    }),
    formData,
    (input, actor) => app.recordHandoff(getPrisma(), { ...input, source: "MANUAL" }, actor),
    "Handoff recorded",
  );
}
