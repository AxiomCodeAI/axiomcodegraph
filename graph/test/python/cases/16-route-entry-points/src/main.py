"""Route registration, and the decorators that LOOK like it.

Every framework registers an HTTP handler the same way: a decorator named after the
method, on an object the author named, carrying the URL path. Three spellings are here
because the rule must not be fitted to one of them.

The point of the case is the NEGATIVE half. `patch` is an HTTP method and also the
stdlib's mock entry point, so `@mock.patch(...)` satisfies <receiver>.<verb> exactly.
It is not a route, and neither is a decorator whose argument is a dotted name.
"""
from unittest import mock


class _App:
    """Stands in for a Flask/FastAPI app object — the corpus has no framework staged."""
    def route(self, path, **kw): return lambda f: f
    def get(self, path): return lambda f: f
    def post(self, path): return lambda f: f
    def patch(self, path): return lambda f: f
    def websocket(self, path): return lambda f: f


app = _App()
router = _App()
routes = _App()


# ── the real thing: three spellings, one shape ──────────────────────────────
@app.route("/items/<key>")
def flask_style(key):
    return key


@router.get("/items/{key}")
def fastapi_style(key):
    return key


@router.post("/items")
def fastapi_post(body):
    return body


@routes.get("/")
def route_table_style(request):
    return request


@app.patch("/items/{key}")
def genuine_patch_route(key):
    """PATCH is a real HTTP method; the path is what tells it from mock.patch."""
    return key


@app.websocket("/ws")
def socket_style(ws):
    return ws


# ── NOT routes, and each would be one if a condition were dropped ───────────
@mock.patch("main.helper")
def patched_test(_m):
    """<receiver>.<verb> holds exactly. The argument is a dotted target, not a path."""
    return None


@app.route
def no_argument():
    """A bare decorator, no path: nothing registers a route without one."""
    return None


def helper():
    return "helper"
