"""FAMILY 32 — `for x in obj` calls obj.__iter__, and that edge did not exist.

The third edge-that-is-not-a-site, after a property read and a context manager.
CPython compiles `for` to GET_ITER / FOR_ITER, not to a CALL, so there is no call
site to conserve — but `type(obj).__iter__(obj)` runs. 181 classes in the measured
corpus define `__iter__` and not one of those edges was in the graph.

THE ASYNC CONTROL IS THE POINT OF THIS FAMILY. `async for` calls `__aiter__`, not
`__iter__`. The IR could not tell the two apart — the parser emitted
rootContext=FOR_ITERABLE for both — so the protocol was chosen by the TYPE: a class
with no `__aiter__` cannot appear in `async for`, so every FOR_ITERABLE over it was
a sync loop. Sound, and it DECLINED on a class defining both.

parser#153 ended that: an `async for` iterable now carries ASYNC_FOR_ITERABLE, so
the statement says which protocol it runs and the type no longer has to guess.
`Both` is here as the case that used to be declined and is now answered exactly —
if it ever goes back to a miss, the root context stopped being read.
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


class Source:
    """A base with two constructed implementors, so iterating the BASE type reaches
    three __iter__ definitions and the edge must be multi_inferred, not known_edge."""

    def __iter__(self) -> Iterator[int]:
        return iter([0])


class SourceA(Source):
    def __iter__(self) -> Iterator[int]:
        return iter([1])


class SourceB(Source):
    def __iter__(self) -> Iterator[int]:
        return iter([2])


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


def decided_by_the_root_context() -> int:
    # `Both` defines __iter__ AND __aiter__. This used to be undecidable and carried an
    # EXPECT: miss, because FOR_ITERABLE was emitted for both statements and the type
    # could not choose. It is a plain `for`, the root context now says so, and the edge
    # is __iter__ exactly. 3 of 202 classes in the corpus are in this state.
    total = 0
    for x in Both():
        total += x
    return total


def a_dispatch_set(s: Source) -> int:
    # The annotation is a DECLARED type, so resolution/dispatch.dl widens it over the
    # constructed subclasses and this one loop reaches Source.__iter__, SourceA.__iter__
    # and SourceB.__iter__. The tier has to say so: a three-member sound set is
    # multi_inferred, and calling it known_edge is the mislabelled certainty this family
    # now guards against. Two of the three are `wide` on any given pass, because tier 4
    # only sees what ran.
    total = 0
    for x in s:
        total += x
    return total


class AsyncOnlyBag:
    """__aiter__ and NO __iter__ — the member that makes a union's protocol ambiguous."""

    def __aiter__(self) -> "AsyncOnlyBag":
        return self

    async def __anext__(self) -> int:
        raise StopAsyncIteration


def sync_comprehension_over_a_union(flag: bool) -> int:
    """A SYNC comprehension cannot run the async protocol, whatever its union holds.

    `src` is a two-write union of a sync-only and an async-only iterable. A comprehension
    compiles to GET_ITER/FOR_ITER, so only __iter__ can run — and before #395 this emitted
    `AsyncOnlyBag.__aiter__` as a known_edge, an impossible target asserted as certain.
    The `for` statement below is the control: it has been exact since #377, because its
    root context says which protocol it is.

    Measured when it was found: 873 such edges over 296 sites on five open-source
    projects, 867 of them on a held-out one.
    """
    # EXPECT: miss — the __iter__ edge IS emitted (see expected/torture.edges), and what
    # tier 4 additionally records here is the <genexpr> OBJECT being invoked, which is not
    # a syntactic call target. Same declared blind spot as `a_comprehension` above; it is
    # the comprehension, not this fixture's union, that carries it.
    src = Bag([1, 2]) if flag else AsyncOnlyBag()
    return sum(x for x in src)


def sync_for_over_a_union(flag: bool) -> int:
    """The control — the same union through a `for` statement, exact already."""
    src = Bag([3, 4]) if flag else AsyncOnlyBag()
    total = 0
    for x in src:
        total += x
    return total


async def _async_loop() -> int:
    # EXPECT: miss — the mirror of a_self_iterator on the async side: __aiter__ is
    # emitted, __anext__ is not, for the same reason. The __aiter__ half is what
    # ASYNC_FOR_ITERABLE buys: keyed on FOR_ITERABLE this statement matched nothing.
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
    parts.append(str(decided_by_the_root_context()))
    parts.append(str(a_dispatch_set(SourceA())))
    parts.append(str(a_dispatch_set(SourceB())))
    parts.append(str(an_async_for()))
    parts.append(str(sync_comprehension_over_a_union(True)))
    parts.append(str(sync_for_over_a_union(True)))
    return " ".join(parts)
