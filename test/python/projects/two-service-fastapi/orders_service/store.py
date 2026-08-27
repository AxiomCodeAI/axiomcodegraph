from typing import Dict, Optional

from orders_service.domain import Order
from shared.protocols import Repository


class OrderStore(Repository[Order]):
    def __init__(self) -> None:
        self._orders: Dict[str, Order] = {}

    def add(self, item: Order) -> str:
        self._orders[item.identity()] = item
        return item.identity()

    def get(self, key: str) -> Optional[Order]:
        return self._orders.get(key)
