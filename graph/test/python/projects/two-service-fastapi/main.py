"""Runnable scenario — no network, no server. Wires both services in one process so the
CPython oracle can execute the whole cross-service chain.

BOTH Transport implementations are constructed and only the in-process one runs, so a
sound static answer for `Transport.send` is the set and the runtime answer is one member.
Same for the two clients: both built, both exercised.
"""
from typing import Any, Dict, List

from inventory_service.domain import BundleItem, DiscountedItem, Item
from inventory_service.handlers import InventoryHandlers
from inventory_service.store import AuditedItemStore, ItemStore
from orders_service.client import DirectInventoryClient, InventoryClient
from orders_service.domain import GiftOrder, LineItem, Order, RushOrder
from orders_service.handlers import OrderHandlers
from orders_service.store import OrderStore
from shared.serialization import serialize
from shared.transport import (HttpTransport, InProcessTransport,
                              RecordingTransport, Transport)


class FakeResponse:
    def __init__(self, body: Dict[str, Any]):
        self.body = body

    def json(self) -> Dict[str, Any]:
        return self.body


class FakeSession:
    """Stands in for requests.Session so HttpTransport is constructible off-network."""

    def post(self, url: str, json: Any = None) -> FakeResponse:
        return FakeResponse({"key": "offline", "price": 0.0})


def seed_inventory(store: ItemStore) -> ItemStore:
    widget = Item("w1", "widget", 10.0)
    gizmo = DiscountedItem("g1", "gizmo", 20.0, pct=0.25)
    store.add_all([widget, gizmo])
    store.add(BundleItem("b1", "bundle", [widget, gizmo]))
    return store


def build_orders(store: OrderStore) -> OrderStore:
    store.add(Order("o1", [LineItem("w1", 2), LineItem("g1", 1)]))
    store.add(RushOrder("o2", [LineItem("b1", 1)]))
    store.add(GiftOrder("o3", [LineItem("w1", 3)], note="hi"))
    return store


def run_through(client: InventoryClient, orders: OrderStore, keys: List[str]) -> None:
    handlers = OrderHandlers(orders, client)
    for key in keys:
        print(key, handlers.checkout({"key": key}))
    print("described", handlers.describe_all(keys))


def main() -> None:
    inventory = seed_inventory(AuditedItemStore())
    inv_handlers = InventoryHandlers(inventory)

    in_process = InProcessTransport(inv_handlers.routes())
    recording = RecordingTransport(in_process)
    offline_http = HttpTransport("http://localhost:8001/inventory", FakeSession())

    orders = build_orders(OrderStore())
    keys = ["o1", "o2", "o3"]

    # Chain A: through the Transport hierarchy (Recording -> InProcess -> registry).
    run_through(InventoryClient(recording), orders, keys)
    # Chain B: straight at the far service's handler object.
    run_through(DirectInventoryClient(inv_handlers), orders, keys)
    # Chain C: the HTTP implementation, exercised off-network.
    print("http", InventoryClient(offline_http).quote("w1"))

    print("bulk", inv_handlers.bulk_quote({"keys": ["w1", "g1", "b1"]}))
    # Exercise the @retry-decorated handler so the wrapper->target edge is EXECUTED, not
    # merely derivable. Both @retry-decorated functions share one `inner` code object, so
    # this is what tells a sound-but-unexercised edge apart from a wrong one.
    print("retried", inv_handlers.get_item({"key": "g1"}))
    print("routed", recording.send("get_item", {"key": "b1"}))
    print("item", serialize("item", inventory.require("w1")))
    print("order", serialize("order", orders.get("o2")))
    print("labels", [inventory.require(k).label for k in ["w1", "g1", "b1"]])
    print("sent", recording.sent)
    print("transports", [t.describe() for t in (in_process, recording, offline_http)])


if __name__ == "__main__":
    main()
