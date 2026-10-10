/**
 * Normalised state of a Shipment. The happy path runs in declaration order;
 * EXCEPTION and RETURNED sit off the happy path. See the plan's domain model.
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

export const TERMINAL_STATUSES: ReadonlySet<Status> = new Set(["DELIVERED", "RETURNED"]);

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: Status): boolean {
  return TERMINAL_STATUSES.has(status);
}
