import type { Metadata } from "next";
import { headers } from "next/headers";
import { getPrisma } from "@handoff/db";
import { ActionForm, Field } from "@/components/action-form";
import { devLoginAllowed, googleConfig } from "@/lib/auth/config";
import { devSignInAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const devLogin = devLoginAllowed((await headers()).get("host"));
  const users = devLogin ? await getPrisma().user.findMany({ orderBy: { email: "asc" } }) : [];
  const google = googleConfig();

  return (
    <div className="mx-auto mt-16 max-w-sm rounded border border-zinc-200 bg-white p-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-600">Handoff Tracker is for Comfort Works staff.</p>
      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {google ? (
        <a
          href="/auth/google"
          className="mt-6 block rounded bg-zinc-900 px-3 py-2 text-center text-sm text-white"
        >
          Sign in with Google
        </a>
      ) : (
        !devLogin && (
          <p className="mt-6 text-sm text-zinc-600">
            No sign-in method is configured. See docs/deployment.md.
          </p>
        )
      )}

      {devLogin && (
        <div className="mt-6 border-t border-dashed border-amber-300 pt-4">
          <p className="mb-2 text-xs text-amber-800">
            Developer login (localhost only, AUTH_DEV_LOGIN=true)
          </p>
          <ActionForm
            action={devSignInAction}
            submitLabel="Sign in as this user"
            variant="secondary"
            testId="dev-login"
          >
            <Field label="User">
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
