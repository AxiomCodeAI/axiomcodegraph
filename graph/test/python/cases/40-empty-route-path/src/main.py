"""A route registered with an EMPTY path, and the decorators that look like it.

A router or blueprint that carries a prefix serves the prefix itself with an empty
path: `APIRouter(prefix="/orders")` plus `@router.get("")` is `GET /orders`, and a
Flask blueprint with `url_prefix` does the same with `@bp.route("")`. The framework
invokes the handler on a request exactly as it does for `@router.get("/{key}")`.

The negative half: an empty string is accepted only as the FIRST POSITIONAL argument
of a catalogued <receiver>.<verb> decorator. Everything below the second rule would
become an entry point if one of those conditions were dropped.
"""
from unittest import mock


class _Router:
    """Stands in for a FastAPI router / Flask blueprint; no framework is staged."""
    def route(self, path, *a, **kw): return lambda f: f
    def get(self, path, *a, **kw): return lambda f: f
    def post(self, path, *a, **kw): return lambda f: f
    def put(self, path, *a, **kw): return lambda f: f
    def delete(self, path, *a, **kw): return lambda f: f
    def patch(self, path, *a, **kw): return lambda f: f
    def memoize(self, key): return lambda f: f


router = _Router()
bp = _Router()
cache = _Router()


def get(path):
    return lambda f: f


# ── the real thing: the collection endpoints of a prefixed router ────────────
@router.get("")
def list_orders():
    return []


@router.post("")
def create_order(body):
    return body


@router.patch('')
def patch_orders(body):
    return body


@bp.route("")
def list_widgets():
    return "[]"


# ── the sibling that already worked, for comparison ─────────────────────────
@router.get("/{key}")
def get_order(key):
    return key


# ── NOT routes ──────────────────────────────────────────────────────────────
@mock.patch("main.helper")
def patched_test(_m):
    """<receiver>.<verb> holds; the argument is a dotted target, not a path."""
    return None


@cache.memoize("")
def memoized():
    """Empty first argument, but `memoize` is not an HTTP verb."""
    return None


@get("")
def bare_verb():
    """Empty path on a bare `@get` with no receiver: a local helper, not a route."""
    return None


@router.delete("orders", "")
def empty_second_argument():
    """The empty string is not the path argument; neither argument starts with "/"."""
    return None


@router.put(path="")
def keyword_path():
    """Keyword path: excluded for "" exactly as a keyword "/x" is excluded today."""
    return None


def helper():
    return "helper"
