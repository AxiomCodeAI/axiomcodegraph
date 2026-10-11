"""Every place FastAPI reads a Depends marker, and every kind of provider it takes.

Each handler below is guarded by exactly the providers its comment names. The
controls at the end are each one condition away from an injection.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI

from deps import (CartDep, ColorFilter, ShapeDep, WidgetFilter, check_app,
                  check_quota, check_region, load_owner, load_user, quota)

app = FastAPI(dependencies=[Depends(check_app)])
router = APIRouter(dependencies=[Depends(check_region)])
plain_router = APIRouter()


@router.get("/a")
def by_default(user: dict = Depends(load_user)):
    """A parameter's default: the form that already worked. Plus check_region."""
    return user


@router.get("/b")
def by_annotated(owner: Annotated[dict, Depends(load_owner)]):
    """Annotated metadata, written in place. Plus check_region."""
    return owner


@router.get("/c")
def by_alias(cart: CartDep):
    """An Annotated alias imported from another module. Plus check_region."""
    return cart


@router.get("/d", dependencies=[Depends(check_quota)])
def by_decorator():
    """The route's own dependency list, and the router's. check_quota, check_region."""
    return []


@plain_router.get("/widgets")
def list_widgets(f: WidgetFilter = Depends(WidgetFilter), c: ColorFilter = Depends(),
                 ok: bool = Depends(quota), s: ShapeDep = None):
    """A class, the class shortcut, an instance, and the shortcut through an alias.

    WidgetFilter.__init__, ColorFilter.__init__, QuotaCheck.__call__ and
    ShapeFilter.__init__; NOT RateCheck.__call__, and NOT check_region: this router
    has no dependency list.
    """
    return f, c, ok, s


@plain_router.get("/kw")
def by_keyword(owner: dict = Depends(dependency=load_owner)):
    """The provider passed by keyword."""
    return owner


# ── NOT injection, and each would be if one condition were dropped ──────────
@plain_router.get("/meta")
def plain_metadata(n: Annotated[int, "a note"], m: Annotated[dict, load_user]):
    """Annotated metadata with no marker in it: a string, and a bare def."""
    return n, m


def bare_untyped(x=Depends()):
    """The class shortcut with no annotation names no class."""
    return x
