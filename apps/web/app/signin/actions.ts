"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authorizeSignIn } from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { DomainError } from "@handoff/domain";
import { allowedDomain, devLoginAllowed } from "@/lib/auth/config";
import { startSession } from "@/lib/auth/session";

export async function devSignInAction(
  _: { ok: boolean; message: string } | null,
  formData: FormData,
) {
  if (!devLoginAllowed((await headers()).get("host")))
    return { ok: false, message: "Developer login is disabled" };
  try {
    const user = await authorizeSignIn(
      getPrisma(),
      { email: String(formData.get("email") ?? ""), emailVerified: true, method: "dev" },
      { allowedDomain: allowedDomain() },
    );
    await startSession(user);
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    throw error;
  }
  redirect("/");
}
