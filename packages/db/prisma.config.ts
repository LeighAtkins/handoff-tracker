import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// One .env at the repo root serves every package.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/seed.ts",
  },
  // Optional here so `prisma generate` works without a database (e.g. in a Docker build);
  // migrate and the app fail clearly if it is missing when they need it.
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
