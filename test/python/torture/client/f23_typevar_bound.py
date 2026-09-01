"""FAMILY 23 — a type variable's declared upper bound.

`TypeVar("T", bound=Base)` states that T is Base or below. The bound arrives as a type
reference owned by the variable's own binding, and until the parser emitted it there was
nothing to read — so an annotation naming a bounded variable was as opaque as an
unbounded one.

WHAT THIS FAMILY HAS TO BE CAREFUL ABOUT, and the reason it is shaped the way it is.

A bound only ever matters where NOTHING ELSE types the parameter. Reached from a call
site that passes a concrete instance, interprocedural argument flow already knows the
exact type, and a declared annotation is authoritative over flow by design — so the bound
REPLACES an exact answer with its whole dispatch fan. That is the trade every annotation
in this engine already makes, and it is not what this family is testing.

So the bounded calls below are reached through an unannotated LIBRARY function.
Library bodies are staged empty by design, so the engine cannot see what `passthrough`
returns and there is no declared return type to read — the value is one it genuinely
knows nothing about, which is the real situation a bound exists for. Without the bound
rule these sites resolve to nothing; with it they resolve to the bound's hierarchy. That
is what makes this family fail when the rule is removed, which a fixture reached from a
concrete argument could not do — flow would answer it either way and the fixture would
pass green while testing nothing.

The direct calls are kept alongside deliberately, to record the other half: there the
bound widens over an override rather than resolving anything new.

DELIBERATELY not covered, and asserted here so the boundary is visible:
  - CONSTRAINTS. `TypeVar("C", int, str)` is a closed set of alternatives, not an upper
    bound. The parser reports nothing for it, and `constrained` must stay unresolved
    rather than pick one — a wrong answer is worse than a blank.
  - a function-scoped TypeVar's bound, which the parser skips rather than mis-own.
"""
from typing import Type, TypeVar

from tlib import passthrough


class Base:
    def label(self) -> str:
        return "base"


class Derived(Base):
    def label(self) -> str:
        return "derived"


B = TypeVar("B", bound=Base)
C = TypeVar("C", int, str)          # CONSTRAINED, not bounded — no bound exists

def bare_bounded(item: B) -> str:
    return item.label()             # B is Base or below


def class_object_bounded(kls: Type[B]) -> str:
    return kls().label()            # Type[B] holds the CLASS, not an instance


def constrained(value: C) -> str:
    # EXPECT: miss — a constraint list is not an upper bound. Nothing should resolve here;
    # if it ever does, something is inventing a type the declaration does not state.
    return str(value)


# The two halves need SEPARATE callees, and that is the point rather than duplication.
# A parameter is typed by every argument that reaches it from anywhere, so if one function
# were called down both paths the concrete path would type its parameter exactly and the
# untyped path would prove nothing -- the family would pass with the bound rule removed.
def flowed_bounded(item: B) -> str:
    return item.label()


def flowed_class_object(kls: Type[B]) -> str:
    return kls().label()


def via_opaque_value() -> str:
    # THE DISCRIMINATING PATH. `passthrough` is an unannotated library function, and
    # library bodies are staged empty by design, so the engine cannot know what it
    # returns. bare_bounded and class_object_bounded are reached ONLY from here, so their
    # parameters are typed by the bound or not at all: remove the bound rule and both
    # sites resolve to nothing.
    #
    # An untyped dict literal was tried first and is NOT opaque -- the engine reads the
    # literal's values, so the class-object site resolved with the rule removed and that
    # half of the family proved nothing.
    return bare_bounded(passthrough(Derived())) + class_object_bounded(passthrough(Derived))


def via_concrete_argument() -> str:
    # The other half, on its own callees: flow knows these arguments exactly and the
    # authoritative annotation widens them over the override. Recorded so the trade is
    # visible in the goldens, not asserted as an improvement.
    return flowed_bounded(Derived()) + flowed_class_object(Derived)
