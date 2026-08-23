"""Decorator shapes — bare, called, dotted, stacked, and PEP 614 expressions."""
import functools


def bare(fn):
    return fn


def parameterised(tag: str):
    def wrap(fn):
        return fn
    return wrap


class Registry:
    def register(self, fn):
        return fn


REGISTRY = Registry()
HANDLERS = [bare]


@bare
def with_bare() -> int:
    return 1


@parameterised("route")
def with_arguments() -> int:
    return 2


@REGISTRY.register
def with_dotted() -> int:
    return 3


@bare
@parameterised("both")
def stacked() -> int:
    return 4


@HANDLERS[0]
def pep614_subscript() -> int:
    return 5


def memoise(maxsize=None):
    """Local stand-in for functools.lru_cache. The shape under test is a CALLED
    decorator carrying a KEYWORD argument — py_decorator_argument is where
    framework routes and permissions live — and a local one resolves."""
    def wrap(fn):
        return fn
    return wrap


@memoise(maxsize=None)
def cached(n: int) -> int:
    return n


@bare
class DecoratedClass:
    def label(self) -> str:
        return "decorated"


def exercise() -> int:
    return with_bare() + with_arguments() + with_dotted() + stacked() + pep614_subscript()
