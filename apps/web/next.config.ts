import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { NextConfig } from "next";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@handoff/domain", "@handoff/db", "@handoff/carriers"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  experimental: {
    // CSV uploads go through a Server Action; 5 MB covers ~5000 rows with room for multipart overhead.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
