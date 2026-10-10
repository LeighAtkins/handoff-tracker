import { DomainError } from "@handoff/domain";
import type { PrismaClient, Role } from "@handoff/db";
import { writeAudit, type Actor } from "./audit";

export const ROLES: readonly Role[] = ["VIEWER", "OPERATOR", "ADMIN"];

/** VIEWER < OPERATOR < ADMIN. */
export function hasRole(role: Role, needed: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(needed);
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SignInPolicy {
  /** Anyone with a verified address at this domain may sign in, starting as VIEWER. */
  allowedDomain?: string | undefined;
}

/**
 * Decides whether a verified identity may sign in. Users already on the allowlist (the User
 * table) always may; anyone else needs a verified address at the company domain, and gets VIEWER.
 */
export async function authorizeSignIn(
  prisma: PrismaClient,
  identity: { email: string; emailVerified: boolean; method: "google" | "dev" },
  policy: SignInPolicy,
) {
  const email = normaliseEmail(identity.email);
  if (!identity.emailVerified) throw new DomainError("Your email address is not verified");

  return prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email } });
    const domain = policy.allowedDomain?.toLowerCase();
    if (!user) {
      if (!domain || !email.endsWith(`@${domain}`)) {
        throw new DomainError("This address is not allowed. Ask an admin to add you.");
      }
      user = await tx.user.create({ data: { email, role: "VIEWER" } });
    }
    await writeAudit(tx, {
      entityType: "User",
      entityId: user.id,
      action: "SIGNED_IN",
      actor: email,
      after: { method: identity.method },
    });
    return user;
  });
}

async function assertAnotherAdminRemains(tx: Pick<PrismaClient, "user">, exceptUserId: string) {
  const admins = await tx.user.count({ where: { role: "ADMIN", id: { not: exceptUserId } } });
  if (admins === 0) throw new DomainError("There must always be at least one admin");
}

export async function addUser(
  prisma: PrismaClient,
  input: { email: string; role: Role },
  actor: Actor,
) {
  const email = normaliseEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new DomainError("Enter a valid email address");
  return prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email } }))
      throw new DomainError(`${email} is already on the list`);
    const user = await tx.user.create({ data: { email, role: input.role } });
    await writeAudit(tx, {
      entityType: "User",
      entityId: user.id,
      action: "USER_ADDED",
      actor,
      after: { email, role: input.role },
    });
    return user;
  });
}

export async function changeRole(
  prisma: PrismaClient,
  input: { userId: string; role: Role },
  actor: Actor,
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new DomainError("User not found");
    if (user.role === "ADMIN" && input.role !== "ADMIN")
      await assertAnotherAdminRemains(tx, user.id);
    await tx.user.update({ where: { id: user.id }, data: { role: input.role } });
    await writeAudit(tx, {
      entityType: "User",
      entityId: user.id,
      action: "ROLE_CHANGED",
      actor,
      before: { role: user.role },
      after: { email: user.email, role: input.role },
    });
  });
}

export async function removeUser(prisma: PrismaClient, input: { userId: string }, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new DomainError("User not found");
    if (user.email === normaliseEmail(actor)) throw new DomainError("You cannot remove yourself");
    if (user.role === "ADMIN") await assertAnotherAdminRemains(tx, user.id);
    await tx.user.delete({ where: { id: user.id } });
    await writeAudit(tx, {
      entityType: "User",
      entityId: user.id,
      action: "USER_REMOVED",
      actor,
      before: { email: user.email, role: user.role },
    });
  });
}
