"""Callables an ASGI application registers and the framework calls, with no call site.

Lifecycle: a lifespan context manager, a middleware class, a middleware function, an
exception handler, a startup handler. Routes: api_route, add_api_route, and a routes
list holding an endpoint class and a websocket function.
"""
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from starlette.applications import Starlette
from starlette.endpoints import HTTPEndpoint
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.routing import Route, WebSocketRoute


@asynccontextmanager
async def lifespan(app):
    yield


app = FastAPI(lifespan=lifespan)


class Timing(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        return await call_next(request)

    def label(self):
        """Not called by the framework: stays an ordinary method."""
        return "timing"


app.add_middleware(Timing)


@app.middleware("http")
async def add_header(request, call_next):
    return await call_next(request)


@app.exception_handler(ValueError)
async def on_value_error(request, exc):
    return None


@app.on_event("startup")
async def boot():
    return None


router = APIRouter()


@router.api_route("/bulk", methods=["GET", "POST"])
async def bulk():
    return []


async def cancel(key: int):
    return key


router.add_api_route("/orders/{key}/cancel", cancel, methods=["POST"])


class Widgets(HTTPEndpoint):
    async def get(self, request):
        return None

    async def post(self, request):
        return None

    def render(self):
        """Not named for a verb: not an entry point."""
        return None


async def feed(websocket):
    return None


async def health(request):
    return None


routes = [Route("/widgets", Widgets), WebSocketRoute("/feed", endpoint=feed)]
side = Starlette(routes=[Route("/health", health)])


# ── NOT registrations, and each would be if one condition were dropped ──────
class Registry:
    def add_route(self, name, fn):
        return fn

    def exception_handler(self, fn):
        return fn


registry = Registry()


def plugin_hook():
    return None


registry.add_route("pkg.hooks.plugin", plugin_hook)


@registry.exception_handler
def bare_handler(exc):
    """The decorator names nothing it handles."""
    return exc


def configure(lifespan_seconds=0):
    return lifespan_seconds


def tick():
    return 0


configure(lifespan_seconds=tick)
