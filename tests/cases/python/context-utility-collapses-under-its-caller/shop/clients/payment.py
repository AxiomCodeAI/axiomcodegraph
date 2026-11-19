from shop.observability.logging_setup import get_logger, log_event
from shop.observability.metrics import increment
from shop.utils.retry import retry
from shop.utils.serialization import to_json

log = get_logger(__name__)


class PaymentClient:
    def __init__(self, transport):
        self.transport = transport

    @retry(times=3)
    def refund(self, payment_id, amount_cents):
        increment("payment.refund")
        log_event(log, "refund", payment_id=payment_id, amount=amount_cents)
        body = to_json(RefundRequest(payment_id, amount_cents))
        return self.transport.post("/refunds", body)

    @retry(times=3)
    def void(self, payment_id):
        increment("payment.void")
        log.info("void %s", payment_id)
        return self.transport.post("/voids", to_json(VoidRequest(payment_id)))


class RefundRequest:
    def __init__(self, payment_id, amount_cents):
        self.payment_id = payment_id
        self.amount_cents = amount_cents


class VoidRequest:
    def __init__(self, payment_id):
        self.payment_id = payment_id
