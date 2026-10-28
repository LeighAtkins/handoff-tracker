import { orderNumberFrom, trackingForOrders } from "@handoff/app";
import { getPrisma } from "@handoff/db";
import { isLocalRequest, notLocal } from "@/lib/api/local-only";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/126362/tracking (also #126362, %23126362 or CW-339312): every shipment on the
 * order with its latest tracking. 404 when we have no such order. Read-only, local requests only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ order: string }> }) {
  if (!isLocalRequest(request)) return notLocal();
  const number = orderNumberFrom((await params).order);
  if (!number) return Response.json({ error: "not an order number" }, { status: 400 });
  const [tracking] = await trackingForOrders(getPrisma(), [number]);
  return tracking
    ? Response.json(tracking)
    : Response.json({ error: "order not found", order: number }, { status: 404 });
}
