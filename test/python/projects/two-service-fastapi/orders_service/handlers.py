"""Order handlers. `checkout` is the top of the cross-service call chain."""
from typing import Any, Dict, List

from orders_service.client import InventoryClient
from orders_service.domain import GiftOrder, LineItem, Order, RushOrder
from orders_service.store import OrderStore
from shared.errors import NotFound
from shared.retry import retry
from shared.serialization import Serializer, serializer

Payload = Dict[str, Any]


@serializer("order")
class OrderSerializer(Serializer):
    def to_dict(self, obj: Order) -> Payload:
        return self.envelope(obj.kind(), {"key": obj.identity(), "lines": obj.count()})


class OrderHandlers:
    def __init__(self, store: OrderStore, client: InventoryClient):
        self.store = store
        self.client = client

    def place(self, payload: Payload) -> Payload:
        lines = [LineItem(l["key"], l["qty"]) for l in payload["lines"]]
        order = self._make(payload.get("mode", "plain"), payload["key"], lines)
        self.store.add(order)
        return OrderSerializer().to_dict(order)

    def _make(self, mode: str, key: str, lines: List[LineItem]) -> Order:
        # Explicit construction dispatch: three concrete Order subclasses.
        if mode == "rush":
            return RushOrder(key, lines)
        if mode == "gift":
            return GiftOrder(key, lines, note="enjoy")
        return Order(key, lines)

    @retry(times=2)
    def checkout(self, payload: Payload) -> Payload:
        order = self.store.get(payload["key"])
        if order is None:
            raise NotFound(payload["key"])
        return {"key": order.identity(), "total": order.total(self.client)}

    def describe_all(self, keys: List[str]) -> List[str]:
        return [order.label for order in self.store.get_all(keys)]
