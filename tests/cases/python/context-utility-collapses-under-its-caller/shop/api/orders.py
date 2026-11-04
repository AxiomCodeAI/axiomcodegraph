from shop.clients.payment import PaymentClient
from shop.observability.logging_setup import get_logger
from shop.observability.metrics import increment
from shop.repository.orders import OrderRepository
from shop.service.cancellation import CancellationError, OrderCancellationService
from shop.utils.serialization import to_json
from shop.utils.strings import normalize_id

log = get_logger(__name__)


def make_service(transport, notifier):
    return OrderCancellationService(OrderRepository(), PaymentClient(transport), notifier)


def cancel_order_endpoint(request, transport, notifier):
    increment("api.cancel")
    order_id = normalize_id(request["order_id"])
    service = make_service(transport, notifier)
    try:
        order = service.cancel_order(order_id, request.get("reason", ""))
    except CancellationError as e:
        log.warning("cancel refused %s", e)
        return 409, {"error": str(e)}
    return 200, to_json(order)
