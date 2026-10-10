import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { NextConfig } from "next";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@handoff/domain", "@handoff/db", "@handoff/carriers"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;
