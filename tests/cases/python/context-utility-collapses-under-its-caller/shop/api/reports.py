from shop.observability.metrics import increment
from shop.repository.orders import OrderRepository
from shop.utils.serialization import to_json
from shop.utils.strings import format_money, normalize_id


def order_summary(request):
    increment("api.summary")
    order = OrderRepository().get(normalize_id(request["order_id"]))
    return {"total": format_money(order.amount_cents), "raw": to_json(order)}
