import { increment } from "../observability/metrics";
import { logDebug } from "../observability/logger";
import { normalizeId } from "../utils/strings";

export class Order {
  constructor(
    public orderId: string,
    public amountCents: number,
    public status = "open",
    public paymentId?: string,
  ) {}
}

export class OrderRepository {
  private rows = new Map<string, Order>();

  get(orderId: string): Order | undefined {
    const key = normalizeId(orderId);
    increment("repo.get");
    logDebug("loading order " + key);
    return this.rows.get(key);
  }

  save(order: Order): void {
    increment("repo.save");
    logDebug("saving order " + order.orderId);
    this.rows.set(normalizeId(order.orderId), order);
  }
}
