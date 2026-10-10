"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as app from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { DomainError } from "@handoff/domain";
import { getActor } from "@/lib/actor";
import { NotAllowedError } from "@/lib/auth/session";

type ActionState = { ok: boolean; message: string } | null;
const role = z.enum(["VIEWER", "OPERATOR", "ADMIN"]);

async function asAdmin(
  work: (actor: string) => Promise<unknown>,
  success: string,
): Promise<ActionState> {
  try {
    await work(await getActor("ADMIN"));
  } catch (error) {
    if (error instanceof DomainError || error instanceof NotAllowedError)
      return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/admin/users");
  return { ok: true, message: success };
}

export async function addUserAction(_: ActionState, formData: FormData) {
  const input = z.object({ email: z.string(), role }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { ok: false, message: "Enter an email and a role" };
  return asAdmin((actor) => app.addUser(getPrisma(), input.data, actor), "Added");
}

export async function changeRoleAction(_: ActionState, formData: FormData) {
  const input = z
    .object({ userId: z.string().min(1), role })
    .safeParse(Object.fromEntries(formData));
  if (!input.success) return { ok: false, message: "Choose a role" };
  return asAdmin((actor) => app.changeRole(getPrisma(), input.data, actor), "Saved");
}

export async function removeUserAction(_: ActionState, formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  return asAdmin((actor) => app.removeUser(getPrisma(), { userId }, actor), "Removed");
}
