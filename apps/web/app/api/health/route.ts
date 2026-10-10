import { getPrisma } from "@handoff/db";

export const dynamic = "force-dynamic";

/** Liveness and readiness: the server is up and can reach the database. */
export async function GET() {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "database unreachable" }, { status: 503 });
  }
}
