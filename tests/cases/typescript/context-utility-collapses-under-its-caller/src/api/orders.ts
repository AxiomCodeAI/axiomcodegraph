import { PaymentClient, Transport } from "../clients/payment";
import { increment } from "../observability/metrics";
import { logInfo } from "../observability/logger";
import { OrderRepository } from "../repository/orders";
import { CancellationError, Notifier, OrderCancellationService } from "../service/cancellation";
import { toJson } from "../utils/serialization";
import { normalizeId } from "../utils/strings";

export function makeService(transport: Transport, notifier: Notifier): OrderCancellationService {
  return new OrderCancellationService(new OrderRepository(), new PaymentClient(transport), notifier);
}

export async function cancelOrderEndpoint(
  request: { orderId: string; reason?: string },
  transport: Transport,
  notifier: Notifier,
): Promise<[number, string]> {
  increment("api.cancel");
  const orderId = normalizeId(request.orderId);
  const service = makeService(transport, notifier);
  try {
    const order = await service.cancelOrder(orderId, request.reason ?? "");
    return [200, toJson(order)];
  } catch (e) {
    if (e instanceof CancellationError) {
      logInfo("cancel refused", { error: e.message });
      return [409, e.message];
    }
    throw e;
  }
}
