import { orderNumberFrom, trackingForOrders } from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { isLocalRequest, notLocal } from "@/lib/api/local-only";

export const dynamic = "force-dynamic";

const MAX_ORDERS = 200;

/**
 * GET /api/tracking?orders=126362,126116,CW-339312: the batch form of
 * /api/orders/<order>/tracking. Orders we do not have are listed under not_found.
 */
export async function GET(request: Request) {
  if (!isLocalRequest(request)) return notLocal();
  const requested = (new URL(request.url).searchParams.get("orders") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!requested.length || requested.length > MAX_ORDERS) {
    return Response.json({ error: `give 1 to ${MAX_ORDERS} orders` }, { status: 400 });
  }
  const numbers = requested.map(orderNumberFrom);
  const invalid = requested.filter((_, i) => !numbers[i]);
  const valid = [...new Set(numbers.filter((n): n is string => n !== null))];
  const orders = await trackingForOrders(getPrisma(), valid);
  const found = new Set(orders.map((o) => o.order));
  return Response.json({
    orders,
    not_found: valid.filter((n) => !found.has(n)),
    invalid,
  });
}
