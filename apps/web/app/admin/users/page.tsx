import type { Metadata } from "next";
import { getPrisma } from "@handoff/db";
import { ActionForm, Field } from "@/components/action-form";
import { allowedDomain } from "@/lib/auth/config";
import { requireUser } from "@/lib/auth/session";
import { addUserAction, changeRoleAction, removeUserAction } from "./actions";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const ROLES = ["VIEWER", "OPERATOR", "ADMIN"] as const;

export default async function UsersPage() {
  const me = await requireUser("ADMIN");
  const users = await getPrisma().user.findMany({ orderBy: [{ role: "desc" }, { email: "asc" }] });
  const domain = allowedDomain();

  return (
    <>
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {domain
          ? `Anyone with a verified @${domain} Google account can sign in as a viewer. Add people here to give them more, or to let in other addresses.`
          : "Only the addresses listed here can sign in."}{" "}
        Viewers can look; operators can add events, notes, overrides and imports; admins also manage
        this list.
      </p>

      <table className="mt-6 w-full bg-white text-left text-sm shadow-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="p-2 font-medium">Email</th>
            <th className="p-2 font-medium">Role</th>
            <th className="p-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-zinc-100 align-top">
              <td className="p-2">{user.email}</td>
              <td className="p-2">
                <ActionForm action={changeRoleAction} submitLabel="Save" variant="secondary">
                  <input type="hidden" name="userId" value={user.id} />
                  <select
                    name="role"
                    defaultValue={user.role}
                    className="rounded border border-zinc-300 bg-white px-2 py-1"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </ActionForm>
              </td>
              <td className="p-2">
                {user.id !== me.id && (
                  <ActionForm action={removeUserAction} submitLabel="Remove" variant="secondary">
                    <input type="hidden" name="userId" value={user.id} />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-8 max-w-md rounded border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Add someone</h2>
        <ActionForm action={addUserAction} submitLabel="Add">
          <Field label="Email">
            <input name="email" type="email" required />
          </Field>
          <Field label="Role">
            <select name="role" defaultValue="VIEWER">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
        </ActionForm>
      </section>
    </>
  );
}
