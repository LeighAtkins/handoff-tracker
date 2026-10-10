import type { Role } from "@handoff/db";
import { requireRole } from "@/lib/auth/session";

/** The signed-in user's email, for the audit log. Throws NotAllowedError without the role. */
export async function getActor(role: Role = "OPERATOR"): Promise<string> {
  return (await requireRole(role)).email;
}
