import { cookies } from "next/headers";
import { Google, generateCodeVerifier, generateState } from "arctic";
import { googleConfig } from "@/lib/auth/config";

export async function GET() {
  const config = googleConfig();
  if (!config) return new Response("Google sign-in is not configured", { status: 404 });
  const google = new Google(config.clientId, config.clientSecret, config.redirectUri);
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = google.createAuthorizationURL(state, verifier, ["openid", "email"]);
  const domain = process.env.ALLOWED_EMAIL_DOMAIN;
  if (domain) url.searchParams.set("hd", domain); // hint only; the callback enforces the domain

  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: config.redirectUri.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  jar.set("google_state", state, options);
  jar.set("google_verifier", verifier, options);
  return Response.redirect(url.toString(), 302);
}
