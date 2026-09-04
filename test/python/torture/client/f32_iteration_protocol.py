"""FAMILY 32 — `for x in obj` calls obj.__iter__, and that edge did not exist.

The third edge-that-is-not-a-site, after a property read and a context manager.
CPython compiles `for` to GET_ITER / FOR_ITER, not to a CALL, so there is no call
site to conserve — but `type(obj).__iter__(obj)` runs. 181 classes in the measured
corpus define `__iter__` and not one of those edges was in the graph.

THE ASYNC CONTROL IS THE POINT OF THIS FAMILY. `async for` calls `__aiter__`, and
the IR cannot tell it from `for`: the parser emits rootContext=FOR_ITERABLE for
both. The gate is the TYPE — a class with no `__aiter__` cannot appear in
`async for` at all, so every FOR_ITERABLE over it is a sync loop. `Both` is the
case the gate declines, and it is here so that declining stays deliberate.
"""
import asyncio
from typing import Iterator, List


class Bag:
    def __init__(self, items: List[int]) -> None:
        self._items = items

    def __iter__(self) -> Iterator[int]:
        return iter(self._items)


class SelfIterator:
    """Defines __next__ as well, which must NOT produce an edge — see below."""

    def __init__(self, n: int) -> None:
        self._n = n

    def __iter__(self) -> "SelfIterator":
        return self

    def __next__(self) -> int:
        if self._n <= 0:
            raise StopIteration
        self._n -= 1
        return self._n


class AsyncBag:
    def __init__(self, items: List[int]) -> None:
        self._items = items

    def __aiter__(self) -> "AsyncBag":
        return self

    async def __anext__(self) -> int:
        if not self._items:
            raise StopAsyncIteration
        return self._items.pop()


class Both:
    """Defines BOTH protocols, so FOR_ITERABLE over it is undecidable in the IR."""

    def __iter__(self) -> Iterator[int]:
        return iter([1])

    def __aiter__(self) -> "Both":
        return self

    async def __anext__(self) -> int:
        raise StopAsyncIteration


def a_for_statement() -> int:
    total = 0
    for x in Bag([1, 2, 3]):
        total += x
    return total


def a_comprehension() -> int:
    # EXPECT: miss — the __iter__ edge IS emitted (see expected/torture.edges), but
    # tier 4 also records the <genexpr> OBJECT being invoked on this line, and a
    # generator is not a syntactic call target so no call-site-based resolver can
    # reach it. Identical to f16_element_types.via_comprehension, which documents the
    # same thing. The comprehension's iterable is PARENTED under the comprehension
    # rather than being a depth-0 root, which is why it needs its own clause at all.
    return sum(x for x in Bag([4, 5]))


def a_local_receiver() -> int:
    b = Bag([6])
    total = 0
    for x in b:
        total += x
    return total


def a_self_iterator() -> int:
    # EXPECT: miss — __iter__ IS an edge and is emitted. __next__ is NOT: `for` calls
    # __next__ on whatever
    # __iter__ RETURNED, and the engine cannot tell a self-iterator from a class that
    # hands back a separate generator without following the return. So tier 4 observes
    # a __next__ link this deliberately does not emit, and the family carries it as an
    # expected miss rather than pretending the protocol is fully modelled.
    total = 0
    for x in SelfIterator(3):
        total += x
    return total


def undecidable_by_the_ir() -> int:
    # EXPECT: miss — `Both` defines __iter__ AND __aiter__, so FOR_ITERABLE over it
    # could be either protocol and the IR does not say which. The gate declines, and
    # that is correct: emitting __iter__ here would fabricate an edge on every
    # `async for` over such a class. 3 of 202 classes in the corpus are in this state.
    total = 0
    for x in Both():
        total += x
    return total


async def _async_loop() -> int:
    # EXPECT: miss — the mirror of a_self_iterator on the async side: __aiter__ is
    # emitted, __anext__ is not, for the same reason.
    total = 0
    async for y in AsyncBag([7, 8]):
        total += y
    return total


def an_async_for() -> int:
    return asyncio.run(_async_loop())


def drive() -> str:
    # Deliberately NOT a generator expression: a genexpr here would put a <genexpr>
    # object invocation in tier 4 that no call-site resolver can reach, manufacturing
    # a miss in the driver rather than in a construct under test.
    parts = []
    parts.append(str(a_for_statement()))
    parts.append(str(a_comprehension()))
    parts.append(str(a_local_receiver()))
    parts.append(str(a_self_iterator()))
    parts.append(str(undecidable_by_the_ir()))
    parts.append(str(an_async_for()))
    return " ".join(parts)
