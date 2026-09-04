"""FAMILY 16 — a container held on something other than `self`.

iteration.dl read a container through expr_attr_of_self, which requires the object to be a
SELF_REFERENCE. So iterating `self.hooks` resolved and iterating the identical field
through any other object did not, leaving the loop variable unbound and every call on it
unresolved. Same shape as the attribute-typing case, one layer down.
"""
from typing import List

from tlib.shapes import squares


class Hook:
    def process(self, n: int) -> int:
        return n + 1


class Engine:
    def __init__(self, hooks: List[Hook]) -> None:
        self.hooks: List[Hook] = hooks         # declared element type
        self.spares = hooks                    # element type from the PARAMETER

    def via_self(self, n: int) -> int:
        for h in self.hooks:                   # the case that already worked
            n = h.process(n)
        return n


def via_parameter(engine: Engine, n: int) -> int:
    for h in engine.hooks:                     # object is a parameter, not self
        n = h.process(n)
    return n


def via_parameter_from_param_field(engine: Engine, n: int) -> int:
    for h in engine.spares:                    # element type carried from a parameter
        n = h.process(n)
    return n


def via_comprehension(engine: Engine) -> int:
    # EXPECT: miss — tier-4 records the <genexpr> OBJECT being invoked at this line as
    # well as h.process. The generator is not a syntactic call target, so the genexpr
    # link is unreachable for any call-site-based resolver; `h.process` itself resolves.
    return sum(h.process(1) for h in engine.hooks)


def via_local(engine: Engine, n: int) -> int:
    e = engine                                 # object reached through a local
    for h in e.hooks:
        n = h.process(n)
    return n


def via_library_container_return() -> str:
    """A LIBRARY function declaring `-> List[Square]`, iterated.

    The scalar mirror of this already resolved: a library callee declaring
    `-> Square` types the call through call_returns_lib_type. The container form
    reached no relation at all, so the loop variable was unbound and every call on
    it was a declared unknown — an asymmetry between two annotations that differ
    only by a subscript, not a ceiling either of them hits.
    """
    out = []
    for s in squares(2):
        out.append(s.name())
    return "".join(out)
