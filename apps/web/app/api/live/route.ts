export const dynamic = "force-dynamic";

/** Liveness: the process is up. Deliberately does not touch the database (see /api/health). */
export function GET() {
  return Response.json({ ok: true });
}
