"""FAMILY 26 — a local variable's annotation types the value (#123, PEP 526).

The engine read annotations on parameters, fields and returns and ignored the one on a
local. Both halves are covered here: an annotation naming a BUILTIN, and one naming a
CLASS in the tree -- the second loses a real client edge, not just a boundary label.

BOTH VALUES COME THROUGH `passthrough`, the unannotated library function, and that is what
makes the family discriminate. Library bodies are staged empty by design, so the engine
cannot see what it returns: no flow reaches either local and the annotation is the only
statement about it. Assigning `set()` or `Derived()` directly would let literal inference
and value flow answer both sites, and the fixture would pass with the rule reverted.

An annotation is a DECLARED type, so `declared.label()` must widen over the override
rather than naming Base alone -- the confident-wrong shape this engine has produced four
times from exactly this omission.
"""
from tlib import passthrough


class Base:
    def label(self) -> str:
        return "base"


class Derived(Base):
    def label(self) -> str:
        return "derived"


def from_builtin_annotation() -> int:
    # `set[int]` is the only thing that says this is a set, so `.add` is set.add.
    seen: set[int] = passthrough(set())
    seen.add(1)
    return len(seen)


def from_class_annotation() -> str:
    # Declared Base, holding a Derived at runtime. The annotation is an upper bound, so
    # the answer must include the override.
    item: Base = passthrough(Derived())
    return item.label()
