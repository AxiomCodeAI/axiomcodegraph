"""FastAPI wiring for service B, plus the HTTP transport pointed at service A."""
from typing import Any, Dict, List

import requests
from fastapi import APIRouter, Depends, FastAPI

from orders_service.client import InventoryClient
from orders_service.handlers import OrderHandlers
from orders_service.store import OrderStore
from shared.transport import HttpTransport, RecordingTransport, Transport

router = APIRouter(prefix="/orders")
INVENTORY_URL = "http://localhost:8001/inventory"


def build_transport() -> Transport:
    session = requests.Session()
    return RecordingTransport(HttpTransport(INVENTORY_URL, session))


_STORE = OrderStore()
_HANDLERS = OrderHandlers(_STORE, InventoryClient(build_transport()))


def get_handlers() -> OrderHandlers:
    return _HANDLERS


@router.post("/orders")
def post_order(body: Dict[str, Any], handlers: OrderHandlers = Depends(get_handlers)) -> Dict[str, Any]:
    return handlers.place(body)


@router.get("/orders/{key}/checkout")
def get_checkout(key: str, handlers: OrderHandlers = Depends(get_handlers)) -> Dict[str, Any]:
    return handlers.checkout({"key": key})


def create_app() -> FastAPI:
    app = FastAPI(title="orders")
    app.include_router(router)
    return app
