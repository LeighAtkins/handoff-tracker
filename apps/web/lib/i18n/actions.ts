"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE } from "./index";

export async function setLocaleAction(formData: FormData) {
  const locale = formData.get("locale") === "ja" ? "ja" : "en";
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 365 * 24 * 3600,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
