"""Polymorphic pricing on top of the shared diamond.

`unit_price` is overridden three times and called through the base type, so a receiver
typed only as `Item` has a real dispatch set. BundleItem's override recurses through the
SAME polymorphic call on its children.
"""
from typing import List

from shared.models import Record


class Item(Record):
    def __init__(self, key: str, name: str, price: float):
        super().__init__(key)
        self.name = name
        self.price = price

    def kind(self) -> str:
        return "item"

    def unit_price(self) -> float:
        return self.price

    def summary(self) -> str:
        return self.describe() + "@" + str(self.unit_price())


class DiscountedItem(Item):
    def __init__(self, key: str, name: str, price: float, pct: float = 0.10):
        super().__init__(key, name, price)
        self.pct = pct

    def kind(self) -> str:
        return "discounted"

    def unit_price(self) -> float:
        return super().unit_price() * (1.0 - self.pct)


class BundleItem(Item):
    def __init__(self, key: str, name: str, children: List[Item]):
        super().__init__(key, name, 0.0)
        self.children = children

    def kind(self) -> str:
        return "bundle"

    def unit_price(self) -> float:
        # Polymorphic recursion: each child may be any Item subclass.
        return sum(child.unit_price() for child in self.children)

    def count(self) -> int:
        return len(self.children)
