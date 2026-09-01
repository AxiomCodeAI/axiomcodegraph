"""FAMILY 18 — a dispatch table of lambdas, keyed by data.

A class-level dict mapping keys to lambdas, invoked with the instance passed explicitly,
is a standard way to write extensible dispatch in Python. Two things stopped it resolving:
the table is a CLASS-level attribute, where dict entries were only ever keyed on a binding;
and the key is data, so the pinned-key clause cannot fire.

The failure compounds — the lambda is never reached as a callee, so its parameters are
never bound, so `self` inside the body has no type, so every call on it is unresolved.

NOTE what is deliberately NOT done: a lambda parameter named `self` is never treated as
`self`. The name carries no privilege inside a lambda. The type arrives from the ARGUMENT
at the call site, which is why `via_other_receiver` below resolves to Other and not to
Renderer.
"""
from typing import ClassVar, Dict


class Other:
    def emit(self) -> str:
        return "other"


class Renderer:
    def render_a(self, n: int) -> str:
        return f"a{n}"

    def render_b(self, n: int) -> str:
        return f"b{n}"

    TRANSFORMS: ClassVar[Dict[str, object]] = {
        "a": lambda self, n: self.render_a(n),
        "b": lambda self, n: self.render_b(n),
    }

    def dispatch_computed(self, kind: str, n: int) -> str:
        # the key is DATA — the union of the table's entries is the sound answer
        return self.TRANSFORMS[kind](self, n)

    def dispatch_pinned(self, n: int) -> str:
        # a pinned key must keep its EXACT single answer, not fan to the whole table
        return self.TRANSFORMS["a"](self, n)


OTHER_TABLE = {"x": lambda obj, n: obj.emit()}


def via_other_receiver(n: int) -> str:
    """The control that proves this is argument flow and not a naming convention: the
    lambda's first parameter is named `obj`, and it is passed an Other — so it must
    resolve to Other.emit, with Renderer nowhere in the answer."""
    return OTHER_TABLE["x"](Other(), n)
