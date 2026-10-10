import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: no session cookie means "go and sign in". Pages and Server Actions still
 * verify the session and role themselves (lib/auth/session.ts).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("ht_session")) return NextResponse.next();
  const url = new URL("/signin", request.url);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!signin|auth/|api/health|_next/|favicon.ico|icon.svg).*)"],
};
