import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addUser, authorizeSignIn, changeRole, hasRole, removeUser } from "../src";
import { prisma, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const policy = { allowedDomain: "comfort-works.com" };

describe("authorizeSignIn", () => {
  it("lets allowlisted users in with their role and audits the sign-in", async () => {
    await prisma.user.create({ data: { email: "contractor@gmail.com", role: "OPERATOR" } });
    const user = await authorizeSignIn(
      prisma,
      { email: " Contractor@Gmail.com ", emailVerified: true, method: "google" },
      policy,
    );
    expect(user.role).toBe("OPERATOR");
    expect(await prisma.auditEntry.findFirst({ where: { action: "SIGNED_IN" } })).toMatchObject({
      actor: "contractor@gmail.com",
    });
  });

  it("creates company-domain users as VIEWER", async () => {
    const user = await authorizeSignIn(
      prisma,
      { email: "staff@comfort-works.com", emailVerified: true, method: "google" },
      policy,
    );
    expect(user.role).toBe("VIEWER");
  });

  it("refuses everyone else, unverified addresses, and look-alike domains", async () => {
    const attempt = (email: string, emailVerified = true) =>
      authorizeSignIn(prisma, { email, emailVerified, method: "google" }, policy);
    await expect(attempt("someone@gmail.com")).rejects.toThrow("not allowed");
    await expect(attempt("staff@comfort-works.com", false)).rejects.toThrow("not verified");
    await expect(attempt("evil@notcomfort-works.com")).rejects.toThrow("not allowed");
    await expect(
      authorizeSignIn(
        prisma,
        { email: "staff@comfort-works.com", emailVerified: true, method: "google" },
        {},
      ),
    ).rejects.toThrow("not allowed");
  });
});

describe("user admin", () => {
  it("adds, promotes and removes users with audit entries", async () => {
    const admin = await prisma.user.create({ data: { email: "admin@example.com", role: "ADMIN" } });
    const user = await addUser(prisma, { email: "New@Example.com", role: "VIEWER" }, admin.email);
    expect(user.email).toBe("new@example.com");
    await changeRole(prisma, { userId: user.id, role: "OPERATOR" }, admin.email);
    await removeUser(prisma, { userId: user.id }, admin.email);
    expect(
      (await prisma.auditEntry.findMany({ orderBy: { at: "asc" } })).map((e) => e.action),
    ).toEqual(["USER_ADDED", "ROLE_CHANGED", "USER_REMOVED"]);
  });

  it("keeps at least one admin and stops self-removal", async () => {
    const admin = await prisma.user.create({ data: { email: "admin@example.com", role: "ADMIN" } });
    await expect(
      changeRole(prisma, { userId: admin.id, role: "VIEWER" }, admin.email),
    ).rejects.toThrow("at least one admin");
    await expect(removeUser(prisma, { userId: admin.id }, admin.email)).rejects.toThrow(
      "cannot remove yourself",
    );
    const other = await prisma.user.create({ data: { email: "other@example.com", role: "ADMIN" } });
    await expect(removeUser(prisma, { userId: admin.id }, other.email)).resolves.toBeUndefined();
    await expect(removeUser(prisma, { userId: other.id }, "someone@example.com")).rejects.toThrow(
      "at least one admin",
    );
  });

  it("rejects duplicates, bad emails and unknown users", async () => {
    await addUser(prisma, { email: "a@example.com", role: "VIEWER" }, "admin");
    await expect(
      addUser(prisma, { email: "A@example.com", role: "VIEWER" }, "admin"),
    ).rejects.toThrow("already on the list");
    await expect(addUser(prisma, { email: "nope", role: "VIEWER" }, "admin")).rejects.toThrow(
      "valid email",
    );
    await expect(changeRole(prisma, { userId: "x", role: "VIEWER" }, "admin")).rejects.toThrow(
      "not found",
    );
    await expect(removeUser(prisma, { userId: "x" }, "admin")).rejects.toThrow("not found");
  });

  it("orders roles", () => {
    expect(hasRole("ADMIN", "OPERATOR")).toBe(true);
    expect(hasRole("VIEWER", "OPERATOR")).toBe(false);
  });
});
