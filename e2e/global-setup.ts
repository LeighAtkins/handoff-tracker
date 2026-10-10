import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Resets to the deterministic fake data. Never point this at real data. */
export function reseed() {
  execFileSync("pnpm", ["db:seed"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "ignore",
  });
}

export default reseed;
