import { increment } from "../observability/metrics";
import { OrderRepository } from "../repository/orders";
import { toJson } from "../utils/serialization";
import { formatMoney, normalizeId } from "../utils/strings";

export function orderSummary(request: { orderId: string }): { total: string; raw: string } {
  increment("api.summary");
  const order = new OrderRepository().get(normalizeId(request.orderId))!;
  return { total: formatMoney(order.amountCents), raw: toJson(order) };
}
