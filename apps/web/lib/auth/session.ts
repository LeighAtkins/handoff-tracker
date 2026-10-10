import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, SignJWT } from "jose";
import { hasRole } from "@handoff/app";
import { getPrisma, type Role } from "@handoff/db";
import { authSecret, SESSION_COOKIE, SESSION_HOURS } from "./config";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

export async function startSession(user: SessionUser) {
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(authSecret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.APP_URL
      ? process.env.APP_URL.startsWith("https://")
      : process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The signed-in user, re-read from the database on every request so that removing someone or
 * changing their role takes effect immediately rather than when their cookie expires.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const user = await getPrisma().user.findUnique({ where: { id: payload.sub } });
    return user ? { id: user.id, email: user.email, role: user.role } : null;
  } catch {
    return null;
  }
}

/** For pages: send anyone not signed in (or without the role) to the sign-in page. */
export async function requireUser(role: Role = "VIEWER"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!hasRole(user.role, role)) redirect("/?denied=1");
  return user;
}

export class NotAllowedError extends Error {
  override name = "NotAllowedError";
}

/** For Server Actions: throws instead of redirecting so the form can show a message. */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new NotAllowedError("Your session has expired. Sign in again.");
  if (!hasRole(user.role, role))
    throw new NotAllowedError(`This needs the ${role.toLowerCase()} role. Ask an admin.`);
  return user;
}
