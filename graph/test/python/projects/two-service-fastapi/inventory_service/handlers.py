"""Route handlers, also the values in the in-process registry.

`price_quote` is the far end of the cross-service chain: orders -> transport -> here ->
Item.unit_price. `get_item` is decorated with a TARGET-REPLACING decorator and
`list_items` with an identity one, so the two must resolve differently.
"""
from typing import Any, Dict, List

from inventory_service.domain import Item
from inventory_service.store import ItemStore
from shared.errors import NotFound, ServiceError
from shared.retry import audited, retry
from shared.serialization import Serializer, serialize, serializer

Payload = Dict[str, Any]


@serializer("item")
class ItemSerializer(Serializer):
    def to_dict(self, obj: Item) -> Payload:
        return self.envelope(obj.kind(), {"key": obj.identity(),
                                          "name": obj.name,
                                          "price": obj.unit_price()})


class InventoryHandlers:
    def __init__(self, store: ItemStore):
        self.store = store

    @retry(times=2)
    def get_item(self, payload: Payload) -> Payload:
        # Reached only through `inner`, never by this name directly.
        item = self.store.require(payload["key"])
        return serialize("item", item)

    @audited
    def list_items(self, keys: List[str]) -> List[Payload]:
        items = self.store.get_all(keys)
        return ItemSerializer().to_dicts(items)

    def price_quote(self, payload: Payload) -> Payload:
        try:
            item = self.store.require(payload["key"])
        except NotFound as exc:
            return exc.as_payload()
        return {"key": item.identity(), "price": item.unit_price()}

    def bulk_quote(self, payload: Payload) -> Payload:
        keys = payload["keys"]
        return {"quotes": [self.price_quote({"key": k}) for k in keys]}

    def failing(self, payload: Payload) -> Payload:
        raise ServiceError("always fails")

    def routes(self) -> Dict[str, Any]:
        # A dict literal of BOUND METHODS — the registry the in-process transport uses.
        return {
            "price_quote": self.price_quote,
            "bulk_quote": self.bulk_quote,
            "get_item": self.get_item,
        }
