import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

/** TEST_DATABASE_URL, or DATABASE_URL pointed at a handoff_test database on the same server. */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set DATABASE_URL or TEST_DATABASE_URL to run these tests");
  const url = new URL(base);
  url.pathname = "/handoff_test";
  return url.toString();
}
