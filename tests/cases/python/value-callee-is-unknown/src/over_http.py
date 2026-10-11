import httpx
from fastapi import APIRouter

router = APIRouter(prefix="/orders")


def record_order(body):
    return dict(body)


def audit(body):
    return body


@router.post("")
def create_order(body: dict):
    return record_order(body)


class OrdersClient:
    def __init__(self, http: httpx.Client):
        self._http = http

    def _call(self, method, url, json=None):
        return self._http.request(method, url, json=json)

    def create(self, body):
        return self._call("POST", "/orders", json=body)

    def headers(self):
        return {"Accept": "application/json"}
