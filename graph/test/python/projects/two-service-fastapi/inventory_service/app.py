"""FastAPI wiring. Every decorator here is EXTERNAL — fastapi is not in the staged
library IR — so the route functions are entry points that no client call site reaches.
An engine that fabricates a caller for them is wrong; one that drops them is also wrong.
"""
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, FastAPI

from inventory_service.domain import BundleItem, DiscountedItem, Item
from inventory_service.handlers import InventoryHandlers
from inventory_service.store import ItemStore

router = APIRouter(prefix="/inventory")
_STORE = ItemStore()
_HANDLERS = InventoryHandlers(_STORE)


def get_handlers() -> InventoryHandlers:
    return _HANDLERS


@router.get("/items/{key}")
def read_item(key: str, handlers: InventoryHandlers = Depends(get_handlers)) -> Dict[str, Any]:
    return handlers.price_quote({"key": key})


@router.post("/quotes")
def post_quotes(keys: List[str], handlers: InventoryHandlers = Depends(get_handlers)) -> Dict[str, Any]:
    return handlers.bulk_quote({"keys": keys})


def seed(store: ItemStore) -> ItemStore:
    widget = Item("w1", "widget", 10.0)
    gizmo = DiscountedItem("g1", "gizmo", 20.0, pct=0.25)
    store.add_all([widget, gizmo])
    store.add(BundleItem("b1", "bundle", [widget, gizmo]))
    return store


def create_app() -> FastAPI:
    app = FastAPI(title="inventory")
    app.include_router(router)
    seed(_STORE)
    return app
