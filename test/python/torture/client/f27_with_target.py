"""FAMILY 27 — `with X() as y` binds the declared return of __enter__ (#128).

WITH_TARGET appeared nowhere in the engine, so the name a `with` statement binds had no
type and every call through it was unresolved. The context manager protocol is
language-defined, so nothing here is inferred.

BOTH ARMS ARE COVERED because they derive the type differently:
  - `__enter__` declaring a concrete type (a forward reference here, which the parser
    unwraps) -- the target takes that type;
  - `__enter__` declaring `Self` -- the target IS the context manager's own type, with no
    return type to resolve.

An __enter__ return is a DECLARED type, not an exact one. `make()` declares Resource and
returns a Sub, so the answer must widen over the override rather than naming Resource
alone -- the confident-wrong shape this engine has produced four times from exactly this
omission.
"""
from typing import Self


class Resource:
    def __enter__(self) -> "Resource":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def use(self) -> str:
        return "resource"


class Sub(Resource):
    def use(self) -> str:
        return "sub"


class SelfRes:
    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def label(self) -> str:
        return "self-res"


def make() -> Resource:
    # A DECLARED return, which is what gives the context manager a type at all. Returning
    # a Sub is what makes the widening observable.
    return Sub()


def via_declared_enter() -> str:
    with make() as r:
        return r.use()


def via_self_enter() -> str:
    with SelfRes() as s:
        return s.label()
