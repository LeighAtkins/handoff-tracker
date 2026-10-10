/** Auth settings, all from the environment. See docs/deployment.md. */
export const SESSION_COOKIE = "ht_session";
export const SESSION_HOURS = 12;

export function authSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) return new TextEncoder().encode(secret);
  if (process.env.NODE_ENV === "production")
    throw new Error("AUTH_SECRET must be set (32+ characters) in production");
  // Local development only: a fixed secret so sessions survive restarts.
  return new TextEncoder().encode("dev-only-secret-do-not-use-in-production!!");
}

export const allowedDomain = () => process.env.ALLOWED_EMAIL_DOMAIN || undefined;

export function googleConfig() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !APP_URL) return null;
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: `${APP_URL}/auth/google/callback`,
  };
}

/**
 * The developer login lets you pick a seeded user without Google. It only works when explicitly
 * enabled AND the request is addressed to localhost, so a stray flag on a server is not enough.
 */
export function devLoginAllowed(host: string | null): boolean {
  if (process.env.AUTH_DEV_LOGIN !== "true") return false;
  const hostname = (host ?? "").replace(/:\d+$/, "");
  return hostname === "localhost" || hostname === "127.0.0.1";
}
