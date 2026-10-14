import time

from shop.clients.payment import PaymentClient
from shop.observability.logging_setup import get_logger, log_event
from shop.observability.metrics import increment, metrics
from shop.repository.orders import OrderRepository
from shop.utils.strings import format_money, truncate

log = get_logger(__name__)


class CancellationError(Exception):
    pass


class OrderCancellationService:
    def __init__(self, repo: OrderRepository, payments: PaymentClient, notifier):
        self.repo = repo
        self.payments = payments
        self.notifier = notifier

    def cancel_order(self, order_id, reason):
        started = time.time()
        log.info("cancel requested %s: %s", order_id, truncate(reason))
        increment("orders.cancel.requested")
        order = self.repo.get(order_id)
        self.check_cancellable(order)
        self.release_payment(order)
        order.status = "cancelled"
        self.repo.save(order)
        self.notify_customer(order, reason)
        log_event(log, "cancelled", order=order.order_id, amount=format_money(order.amount_cents))
        metrics.timing("orders.cancel", started)
        return order

    def check_cancellable(self, order):
        if order is None:
            raise CancellationError("no such order")
        if order.status in ("shipped", "cancelled"):
            increment("orders.cancel.rejected")
            raise CancellationError(f"cannot cancel a {order.status} order")

    def release_payment(self, order):
        if not order.payment_id:
            return
        if order.status == "captured":
            self.payments.refund(order.payment_id, order.amount_cents)
        else:
            self.payments.void(order.payment_id)

    def notify_customer(self, order, reason):
        log.debug("notify %s", order.order_id)
        self.notifier.send(order.order_id, "Your order was cancelled: " + truncate(reason, 40))
