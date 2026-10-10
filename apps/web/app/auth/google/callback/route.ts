import { cookies } from "next/headers";
import { decodeIdToken, Google } from "arctic";
import { authorizeSignIn } from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { DomainError } from "@handoff/domain";
import { allowedDomain, googleConfig } from "@/lib/auth/config";
import { startSession } from "@/lib/auth/session";

function back(request: Request, error: string) {
  return Response.redirect(
    new URL(`/signin?error=${encodeURIComponent(error)}`, request.url).toString(),
    302,
  );
}

export async function GET(request: Request) {
  const config = googleConfig();
  if (!config) return back(request, "Google sign-in is not configured");
  const url = new URL(request.url);
  const jar = await cookies();
  const state = jar.get("google_state")?.value;
  const verifier = jar.get("google_verifier")?.value;
  jar.delete("google_state");
  jar.delete("google_verifier");
  const code = url.searchParams.get("code");
  if (!code || !state || !verifier || url.searchParams.get("state") !== state) {
    return back(request, "Sign-in expired. Try again.");
  }

  try {
    const google = new Google(config.clientId, config.clientSecret, config.redirectUri);
    const tokens = await google.validateAuthorizationCode(code, verifier);
    // The ID token came straight from Google's token endpoint over TLS, so decoding is enough.
    const claims = decodeIdToken(tokens.idToken()) as { email?: string; email_verified?: boolean };
    if (!claims.email) return back(request, "Google did not share an email address");
    const user = await authorizeSignIn(
      getPrisma(),
      { email: claims.email, emailVerified: claims.email_verified === true, method: "google" },
      { allowedDomain: allowedDomain() },
    );
    await startSession(user);
  } catch (error) {
    if (error instanceof DomainError) return back(request, error.message);
    console.error("google sign-in failed", error);
    return back(request, "Sign-in failed. Try again.");
  }
  return Response.redirect(new URL("/", request.url).toString(), 302);
}
