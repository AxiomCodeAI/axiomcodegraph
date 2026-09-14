"""FAMILY 11 — a value with MORE THAN ONE SOURCE.

Each shape below has a value the engine can name, and each resolved to nothing before:
a name written twice, a ternary, and `a or b`. The answer is the UNION — a sound set the
true target is inside — not silence. Flow-insensitive on purpose: in `two_writes` both
writes reach the use, so both targets are emitted and the site is multi_inferred.
"""
from tlib.shapes import Base, Mid


class Plain:
    def emit(self) -> str:
        return "plain"


class Fancy:
    def emit(self) -> str:
        return "fancy"


def two_writes(flag: bool) -> str:
    out = Plain()
    if flag:
        out = Fancy()
    return out.emit()                       # union of BOTH writes


def ternary(flag: bool) -> str:
    w = Fancy() if flag else Plain()
    return w.emit()                         # union of BODY and ORELSE


def boolean_or(given) -> str:
    w = given or Plain()
    return w.emit()                         # union of both operands


def ternary_over_lib(flag: bool) -> str:
    s = Mid() if flag else Base()
    return s.name()                         # the same, across the library boundary


class HoldsTernary:
    """A single-write FIELD whose value is a ternary — the write count is 1, so the
    single-write gate was never the obstacle; the ternary simply had no type."""
    def __init__(self, flag: bool) -> None:
        self.w = Fancy() if flag else Plain()

    def run(self) -> str:
        return self.w.emit()


class HoldsOr:
    def __init__(self, given=None) -> None:
        self.w = given or Plain()

    def run(self) -> str:
        return self.w.emit()
