from shop.observability.logging_setup import get_logger
from shop.observability.metrics import increment
from shop.utils.strings import normalize_id

log = get_logger(__name__)


class Order:
    def __init__(self, order_id, amount_cents, status="open", payment_id=None):
        self.order_id = order_id
        self.amount_cents = amount_cents
        self.status = status
        self.payment_id = payment_id


class OrderRepository:
    def __init__(self):
        self.rows = {}

    def get(self, order_id):
        key = normalize_id(order_id)
        increment("repo.get")
        log.debug("loading order %s", key)
        return self.rows.get(key)

    def save(self, order):
        increment("repo.save")
        log.debug("saving order %s", order.order_id)
        self.rows[normalize_id(order.order_id)] = order
