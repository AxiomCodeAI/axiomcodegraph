import { PaymentClient } from "../clients/payment";
import { logInfo, logDebug } from "../observability/logger";
import { increment, metrics } from "../observability/metrics";
import { Order, OrderRepository } from "../repository/orders";
import { formatMoney, truncate } from "../utils/strings";

export interface Notifier {
  send(orderId: string, message: string): void;
}

export class CancellationError extends Error {}

export class OrderCancellationService {
  constructor(private repo: OrderRepository, private payments: PaymentClient, private notifier: Notifier) {}

  async cancelOrder(orderId: string, reason: string): Promise<Order> {
    const started = Date.now();
    logInfo("cancel requested", { orderId, reason: truncate(reason) });
    increment("orders.cancel.requested");
    const order = this.repo.get(orderId);
    this.checkCancellable(order);
    await this.releasePayment(order!);
    order!.status = "cancelled";
    this.repo.save(order!);
    this.notifyCustomer(order!, reason);
    logInfo("cancelled", { order: order!.orderId, amount: formatMoney(order!.amountCents) });
    metrics.timing("orders.cancel", started);
    return order!;
  }

  checkCancellable(order: Order | undefined): void {
    if (!order) throw new CancellationError("no such order");
    if (order.status === "shipped" || order.status === "cancelled") {
      increment("orders.cancel.rejected");
      throw new CancellationError(`cannot cancel a ${order.status} order`);
    }
  }

  async releasePayment(order: Order): Promise<void> {
    if (!order.paymentId) return;
    if (order.status === "captured") {
      await this.payments.refund(order.paymentId, order.amountCents);
    } else {
      await this.payments.voidPayment(order.paymentId);
    }
  }

  notifyCustomer(order: Order, reason: string): void {
    logDebug("notify " + order.orderId);
    this.notifier.send(order.orderId, "Your order was cancelled: " + truncate(reason, 40));
  }
}
