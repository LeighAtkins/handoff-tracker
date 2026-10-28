/**
 * The tracking API has no sign-in, so it answers only requests addressed to this machine. The
 * server listens on 127.0.0.1 only (the launchd agent passes --hostname 127.0.0.1), so other
 * machines cannot reach it at all; the Host check also turns away pages that point a browser at
 * it under another name (DNS rebinding).
 */
export function isLocalRequest(request: Request): boolean {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  return ["localhost", "127.0.0.1", "[::1]"].includes(host);
}

export const notLocal = () => Response.json({ error: "local requests only" }, { status: 403 });
