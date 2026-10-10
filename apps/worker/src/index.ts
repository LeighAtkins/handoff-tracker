/**
 * Polling worker. Each run checks every open Leg whose carrier poll interval has elapsed,
 * applies new events through the domain, follows handoffs, and re-evaluates stuck shipments.
 *
 *   pnpm --filter @handoff/worker start            # one run (Kubernetes CronJob)
 *   pnpm --filter @handoff/worker start --loop     # every WORKER_INTERVAL_SECONDS (default 300)
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { pollDueLegs, recordWorkerRun, refreshOpenShipments } from "@handoff/app";
import { adapterFor } from "@handoff/carriers";
import { createPrismaClient } from "@handoff/db";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const { values } = parseArgs({ options: { loop: { type: "boolean", default: false } } });
const intervalSeconds = Number(process.env.WORKER_INTERVAL_SECONDS ?? 300);
const prisma = createPrismaClient();

function log(event: string, data: object) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function runOnce() {
  const now = new Date();
  const poll = await pollDueLegs(prisma, { adapterFor: (carrier) => adapterFor(carrier), now });
  const stuck = await refreshOpenShipments(prisma, now);
  await recordWorkerRun(prisma, poll, stuck.changed);
  log("worker.run", {
    ...poll,
    failures: poll.failures.length,
    openShipments: stuck.open,
    refreshed: stuck.changed,
  });
  for (const failure of poll.failures) log("worker.check_failed", failure);
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

try {
  do {
    await runOnce();
    if (values.loop) {
      for (let waited = 0; waited < intervalSeconds && !stopping; waited++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } while (values.loop && !stopping);
} catch (error) {
  log("worker.crashed", { error: error instanceof Error ? error.stack : String(error) });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
