import { cookies } from "next/headers";
import { LOCALES, type Dictionary, type Locale } from "./dictionaries";

export const LOCALE_COOKIE = "lang";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return value === "ja" ? "ja" : "en";
}

/** The dictionary for the current request's language. */
export async function getT(): Promise<Dictionary> {
  return LOCALES[await getLocale()];
}

export type { Dictionary, Locale };

/** formatAgo strings for the current language. */
export async function getAgo() {
  const t = await getT();
  return { never: t.common.never, ...t.ago };
}
