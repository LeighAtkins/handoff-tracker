import type { Metadata } from "next";
import { headers } from "next/headers";
import { getPrisma } from "@handoff/db";
import { ActionForm, Field } from "@/components/action-form";
import { devLoginAllowed, googleConfig } from "@/lib/auth/config";
import { getT } from "@/lib/i18n";
import { devSignInAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const t = await getT();
  const devLogin = devLoginAllowed((await headers()).get("host"));
  const users = devLogin ? await getPrisma().user.findMany({ orderBy: { email: "asc" } }) : [];
  const google = googleConfig();

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
      <svg viewBox="0 0 64 64" className="mb-4 size-10" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#0d9488" />
        <text
          x="32"
          y="32"
          dy="0.35em"
          textAnchor="middle"
          fontSize="26"
          fontWeight="600"
          fill="#fff"
          fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        >
          HT
        </text>
      </svg>
      <h1 className="text-xl font-semibold tracking-tight">{t.signIn.title}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t.signIn.intro}</p>
      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {google ? (
        <a
          href="/auth/google"
          className="mt-6 block rounded-lg bg-teal-700 px-3 py-2 text-center text-sm font-medium text-white hover:bg-teal-800"
        >
          {t.signIn.google}
        </a>
      ) : (
        !devLogin && <p className="mt-6 text-sm text-zinc-600">{t.signIn.none}</p>
      )}

      {devLogin && (
        <div className="mt-6 border-t border-dashed border-amber-300 pt-4">
          <p className="mb-2 text-xs text-amber-800">{t.signIn.devTitle}</p>
          <ActionForm
            action={devSignInAction}
            submitLabel={t.signIn.asUser}
            variant="secondary"
            testId="dev-login"
          >
            <Field label={t.signIn.user}>
              <select name="email">
                {users.map((u) => (
                  <option key={u.id} value={u.email}>
                    {u.email} ({u.role.toLowerCase()})
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
