/**
 * Who is making a change, for the audit log. Until sign-in arrives (Phase 4) this is a fixed
 * development identity; afterwards it comes from the session.
 */
export async function getActor(): Promise<string> {
  return process.env.DEV_ACTOR ?? "dev@localhost";
}
