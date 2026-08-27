"""Two clients with the same interface — one goes over the Transport, one holds the
handler object directly. Both are constructed, so `client.quote(...)` in the domain has a
real two-element dispatch set, and only ONE of the two chains reaches the far service by
a path the engine can follow all the way.
"""
from typing import Any, Dict, List

from shared.transport import Payload, Transport


class InventoryClient:
    """Goes through the Transport: the chain stops at the registry lookup."""

    def __init__(self, transport: Transport):
        self.transport = transport

    def quote(self, key: str) -> Payload:
        return self.transport.send("price_quote", {"key": key})

    def quote_many(self, keys: List[str]) -> List[Payload]:
        return self.transport.send_many("price_quote", [{"key": k} for k in keys])


class DirectInventoryClient(InventoryClient):
    """Holds the far service's handler object. The whole cross-service chain is visible."""

    def __init__(self, handlers: Any):
        self.handlers = handlers

    def quote(self, key: str) -> Payload:
        return self.handlers.price_quote({"key": key})

    def quote_many(self, keys: List[str]) -> List[Payload]:
        return self.handlers.bulk_quote({"keys": keys})["quotes"]
