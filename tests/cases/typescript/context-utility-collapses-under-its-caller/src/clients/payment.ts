import { increment } from "../observability/metrics";
import { logInfo } from "../observability/logger";
import { withRetry } from "../utils/retry";
import { toJson } from "../utils/serialization";

export interface Transport {
  post(path: string, body: string): Promise<number>;
}

export class PaymentClient {
  constructor(private transport: Transport) {}

  async refund(paymentId: string, amountCents: number): Promise<number> {
    increment("payment.refund");
    logInfo("refund", { paymentId, amountCents });
    const body = toJson({ paymentId, amountCents });
    return withRetry(() => this.transport.post("/refunds", body));
  }

  async voidPayment(paymentId: string): Promise<number> {
    increment("payment.void");
    logInfo("void", { paymentId });
    return withRetry(() => this.transport.post("/voids", toJson({ paymentId })));
  }
}
