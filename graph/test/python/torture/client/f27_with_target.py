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

THE ASYNC ARM IS THE THIRD, and it is a different protocol rather than a variation:
`async with c` runs `c.__aenter__` / `c.__aexit__`, never `__enter__`. Until parser#153
the IR could not say which statement a context expression came from — `with cm` and
`async with acm` produced byte-identical rows — so keying on WITH_CONTEXT alone silently
covered both, and once the async root existed it covered neither. What `as` binds on this
arm is `__aenter__`'s declared return, which is the AWAITED value: an `async def
__aenter__(self) -> "AsyncResource"` declares the resource, not a coroutine over it.
"""
import asyncio
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


class AsyncResource:
    async def __aenter__(self) -> "AsyncResource":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    def use(self) -> str:
        return "async-resource"


async def _via_async_enter() -> str:
    async with AsyncResource() as r:
        return r.use()


def via_async_enter() -> str:
    """The async arm: __aenter__ and __aexit__ are the edges, and `r` is typed by
    __aenter__'s declared return exactly as the sync arm's is."""
    return asyncio.run(_via_async_enter())
