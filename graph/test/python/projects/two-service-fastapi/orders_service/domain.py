"""Orders, on the same shared diamond, with a polymorphic total()."""
from typing import Iterable, List

from orders_service.client import InventoryClient
from shared.models import Record


class LineItem:
    def __init__(self, key: str, qty: int):
        self.key = key
        self.qty = qty

    def subtotal(self, client: InventoryClient) -> float:
        quote = client.quote(self.key)          # CROSS-SERVICE CALL
        return float(quote.get("price", 0.0)) * self.qty


class Order(Record):
    def __init__(self, key: str, lines: List[LineItem]):
        super().__init__(key)
        self.lines = lines

    def kind(self) -> str:
        return "order"

    def total(self, client: InventoryClient) -> float:
        return sum(line.subtotal(client) for line in self.lines)

    def count(self) -> int:
        return len(self.lines)


class RushOrder(Order):
    def kind(self) -> str:
        return "rush"

    def total(self, client: InventoryClient) -> float:
        return super().total(client) * 1.2


class GiftOrder(Order):
    def __init__(self, key: str, lines: List[LineItem], note: str = ""):
        super().__init__(key, lines)
        self.note = note

    def kind(self) -> str:
        return "gift"

    def total(self, client: InventoryClient) -> float:
        return super().total(client)
