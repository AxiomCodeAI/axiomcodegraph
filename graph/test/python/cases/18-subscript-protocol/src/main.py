"""The subscript protocol: `obj[k]`, `obj[k] = v` and `C[T]` are calls (#930).

CPython compiles a subscript to BINARY_SUBSCR / STORE_SUBSCR and never to a CALL, so
there is no call site to conserve, exactly as for a property read. The method runs
all the same.

THE OTHER PARTITION IS IN HERE TOO. An ANNOTATION is type syntax, not an expression:
under `from __future__ import annotations` it is a string the interpreter never
evaluates, so `Bag[str]` written as an annotation must produce NO edge, while the
same text in a base class list must produce one.
"""
from __future__ import annotations


class Bag:
    def __init__(self, items):
        self.items = dict(items)

    def __getitem__(self, key):
        return self.items[key]

    def __setitem__(self, key, value):
        self.items[key] = value

    def __class_getitem__(cls, item):
        return cls


class Typed(Bag["int"]):
    """A base class list is evaluated whatever the future import says: this calls
    Bag.__class_getitem__."""


class Plain(Bag):
    """No subscript, so no __class_getitem__ call here."""


def read(bag: Bag) -> object:
    return bag["k"]


def write(bag: Bag) -> None:
    bag["k"] = 1


def annotated(bag: Bag["int"]) -> Bag["int"]:
    """Both subscripts are annotations. Neither runs; neither may be an edge."""
    return bag


def main():
    b = Bag({"k": 0})
    write(b)
    return read(b), Typed, Plain, annotated(b)
