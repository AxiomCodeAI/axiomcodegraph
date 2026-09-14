"""AWAIT — the value a coroutine PRODUCES, in the positions that carry it onward.

The parser wraps an awaited expression in its own node: `x = await f()` is
ASSIGNMENT -> AWAIT -> CALL. Every typing rule reads the assignment's value, an
argument, or a return expression, so before await_yields existed each of them saw
the wrapper, matched nothing, and the awaited value was untyped — along with the
local, field, parameter or element it flowed into.

One function per position, and `gated_by_await_protocol` is the control: it is the
shape that transparency ALONE would answer wrongly, so it must stay a declared
unknown rather than become an answer.
"""
import asyncio
from typing import List, Optional

from tlib.asyncshapes import fetch_box, fetch_boxes


class Widget:
    def render(self) -> str:
        return "W"


class Delayed:
    """Awaitable, and NOT the type of what awaiting it produces.

    `render` is declared here and never runs. It exists so that typing
    `await Delayed(...)` as a Delayed — which is what dropping the async gate
    would do — shows up as a WRONG edge and not merely as imprecision.
    """

    def __init__(self, inner: Widget) -> None:
        self._inner = inner

    def render(self) -> str:
        return "NEVER"

    def __await__(self):
        if False:
            yield
        return self._inner


class Registry:
    def __init__(self) -> None:
        self._built: Optional[Widget] = None

    async def build(self) -> Widget:
        return Widget()

    async def via_self_receiver(self) -> str:
        w = await self.build()
        return w.render()

    async def into_a_field(self) -> str:
        self._built = await self.build()
        return self._built.render()


async def make_widget() -> Widget:
    return Widget()


async def make_widgets() -> List[Widget]:
    return [Widget()]


async def make_name() -> str:
    return "n"


def flows(x) -> str:
    return x.render()


async def into_a_local() -> str:
    w = await make_widget()
    return w.render()


async def awaited_in_place() -> str:
    return (await make_widget()).render()


async def into_an_unannotated_parameter() -> str:
    return flows(await make_widget())


async def a_builtin_result() -> str:
    s = await make_name()
    return s.upper()


async def an_element_of_the_result() -> str:
    out = []
    for w in await make_widgets():
        out.append(w.render())
    return "".join(out)


async def across_the_library_boundary() -> str:
    b = await fetch_box()
    return b.label()


async def a_library_element() -> str:
    out = []
    for b in await fetch_boxes():
        out.append(b.label())
    return "".join(out)


async def gated_by_await_protocol() -> str:
    # EXPECT: miss — `await Delayed(w)` yields the Widget that Delayed.__await__
    # returns, never a Delayed. The callee here is a CLASS, not an `async def`, so
    # no annotation states what awaiting it produces and the correct answer is
    # nothing. Answering Delayed.render would be a fabricated edge.
    return (await Delayed(Widget())).render()


async def _all() -> str:
    """Every shape, one `await` per line.

    Driven by `asyncio.run` from main.py rather than by a hand-rolled
    `coro.send(None)` loop, and the difference is not cosmetic. The engine
    attributes a coroutine call to the line that CREATES the coroutine; tier 4
    attributes the coroutine's body to the line that first sends into it. `await`
    puts both on the same line. A driver function puts the send on its own line
    inside itself, so every coroutine here scored MISSED at the driver's line and
    WIDE at the creation line — ten manufactured defects with no engine change
    behind them. Same convention as test/python/cases/10-comprehension-async.
    """
    r = Registry()
    return " ".join([
        await into_a_local(),
        await awaited_in_place(),
        await into_an_unannotated_parameter(),
        await a_builtin_result(),
        await an_element_of_the_result(),
        await across_the_library_boundary(),
        await a_library_element(),
        await r.via_self_receiver(),
        await r.into_a_field(),
        await gated_by_await_protocol(),
    ])


def drive() -> str:
    """The synchronous entry main.py calls.

    `_all` is private on purpose: it is created here and entered by the event
    loop, so tier 4 records its body starting from an asyncio frame, which
    harness/trace.py filters out. The engine's `drive -> _all` edge is therefore
    real and unobservable, and it is the one `extra` this family contributes. Any
    OTHER arrangement costs more than one: driving each shape with its own
    `asyncio.run` makes ten of them, and a hand-rolled `coro.send` driver makes
    ten missed links as well, at the driver's line.
    """
    return asyncio.run(_all())
