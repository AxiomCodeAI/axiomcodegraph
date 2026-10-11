"""Providers, the classes a marker can name, and module-level Annotated aliases.

An alias is a module-level VALUE, and the handler that uses it usually imports it:
`CartDep = Annotated[dict, Depends(load_cart)]` here, `cart: CartDep` in handlers.py.
"""
from typing import Annotated

from fastapi import Depends


def load_user():
    return {}


def load_owner():
    return {}


def load_cart():
    return {}


def load_shape_size():
    return 1


def check_region():
    return None


def check_quota():
    return None


def check_app():
    return None


class WidgetFilter:
    def __init__(self, q: str = ""):
        self.q = q


class ColorFilter:
    def __init__(self, color: str = ""):
        self.color = color


class ShapeFilter:
    def __init__(self, size: int = Depends(load_shape_size)):
        self.size = size


class QuotaCheck:
    def __call__(self, n: int = 0):
        return n < 5


class RateCheck:
    """A second __call__ nothing hands to a marker: it must stay unreached."""

    def __call__(self, n: int = 0):
        return n < 9


quota = QuotaCheck()
CartDep = Annotated[dict, Depends(load_cart)]
ShapeDep = Annotated[ShapeFilter, Depends()]
