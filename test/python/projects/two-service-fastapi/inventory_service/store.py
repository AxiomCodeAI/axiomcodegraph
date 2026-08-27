"""Repository[Item] — a SUBSCRIPT base over a Generic ABC."""
from typing import Dict, Optional

from inventory_service.domain import Item
from shared.errors import NotFound
from shared.protocols import Repository


class ItemStore(Repository[Item]):
    def __init__(self) -> None:
        self._items: Dict[str, Item] = {}

    def add(self, item: Item) -> str:
        self._items[item.identity()] = item
        return item.identity()

    def get(self, key: str) -> Optional[Item]:
        return self._items.get(key)

    def require(self, key: str) -> Item:
        item = self.get(key)
        if item is None:
            raise NotFound(key)
        return item


class AuditedItemStore(ItemStore):
    """A second implementation, so `self.add` inside add_all has two candidates."""

    def __init__(self) -> None:
        super().__init__()
        self.writes = 0

    def add(self, item: Item) -> str:
        self.writes += 1
        return super().add(item)
