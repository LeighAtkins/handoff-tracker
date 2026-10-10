/**
 * Normalised state of a Shipment. The happy path runs in declaration order;
 * EXCEPTION and RETURNED sit off the happy path. See ADR-0002.
 */
export const STATUSES = [
  "PENDING",
  "SHIPPED",
  "IN_TRANSIT",
  "HANDED_OFF",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "EXCEPTION",
  "RETURNED",
] as const;

export type Status = (typeof STATUSES)[number];

export const HAPPY_PATH: readonly Status[] = [
  "PENDING",
  "SHIPPED",
  "IN_TRANSIT",
  "HANDED_OFF",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export const TERMINAL_STATUSES: ReadonlySet<Status> = new Set(["DELIVERED", "RETURNED"]);

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: Status): boolean {
  return TERMINAL_STATUSES.has(status);
}

function happyRank(status: Status): number {
  return HAPPY_PATH.indexOf(status);
}

/**
 * The status a Shipment moves to when an event reporting `incoming` arrives while it is `current`.
 *
 * - DELIVERED and RETURNED are terminal: nothing moves a Shipment out of them.
 * - EXCEPTION and RETURNED can be reached from any non-terminal status.
 * - Along the happy path a Shipment only moves forward. A backwards report (e.g. Sagawa's
 *   "in transit" scan after 4PX has already handed off) is recorded but leaves status alone.
 * - From EXCEPTION, any happy-path report means the problem cleared, so the Shipment resumes.
 */
export function transition(current: Status, incoming: Status): Status {
  if (isTerminal(current)) return current;
  if (incoming === "EXCEPTION" || incoming === "RETURNED") return incoming;
  if (current === "EXCEPTION") return incoming;
  return happyRank(incoming) > happyRank(current) ? incoming : current;
}
