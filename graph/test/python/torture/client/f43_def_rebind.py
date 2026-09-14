"""FAMILY 43 — a `def` rebound by a later `def` in the same statement list (#383).

A `def` is an assignment to a name, so a second `def` of the same name sequentially
after it rebinds the name and the first function object becomes unreachable through
it. CPython agrees: `getattr_static(Handler, "run").__code__.co_firstlineno` names the
LATER line, and a run records only the later body.

THE TWO CONTROLS ARE WHY THIS FAMILY IS FOUR FUNCTIONS AND NOT ONE. Measured over five
open-source projects, `def`s sharing one declaring binding split three ways:

    433 groups   a PROPERTY PAIR      @property def x / @x.setter def x
    128 groups   DIFFERENT ARMS       if/else, only one is ever defined
     88 defs     sequential           the shape this family is about

So "the later def wins" on its own would delete 561 correct targets to fix 88.
`branched` and `Holder.value` are those two populations, and if either of them ever
collapses to a single target this family fails rather than the corpus quietly losing
answers.
"""
import sys


class Handler:
    def run(self) -> str:
        """DISCARDED by the rebinding below — nothing can reach this body."""
        return "first"

    def run(self) -> str:
        return "second"


def module_level() -> str:
    """DISCARDED, the same way, through the module scope rather than a class body."""
    return "first"


def module_level() -> str:
    return "second"


class Holder:
    """CONTROL — a property pair shares one binding and one name, and BOTH are live.

    They are reached through the descriptor rather than through the name, so the
    rebinding argument does not apply to them at all. 433 of the 617 shared-binding
    groups in the measured corpus are this shape.
    """

    def __init__(self) -> None:
        self._v = 1

    @property
    def value(self) -> int:
        return self._v

    @value.setter
    def value(self, v: int) -> None:
        self._v = v


if sys.version_info >= (3, 8):

    def branched() -> str:
        """CONTROL — different ARMS. Only one of these is ever defined, so neither
        rebinds the other and a two-member set is the correct answer."""
        return "new"

else:

    def branched() -> str:
        return "old"


def call_method() -> str:
    """Exactly one target: the later `run`."""
    return Handler().run()


def call_module_level() -> str:
    """Exactly one target: the later `module_level`."""
    return module_level()


def call_branched() -> str:
    """BOTH targets: the arms are alternatives, not a rebinding."""
    return branched()


def read_property() -> int:
    """The getter survives — the control that keeps this rule off property pairs.

    EXPECT: miss — `h.value = 5` invokes the SETTER, and the engine emits a
    PROPERTY_READ edge for a property read and nothing at all for a property WRITE.
    That is a pre-existing gap this fixture happens to expose, not something #383
    changed; the getter edge on the next line is what this family is asserting.
    """
    h = Holder()
    h.value = 5
    return h.value


def drive() -> str:
    return " ".join((
        call_method(),
        call_module_level(),
        call_branched(),
        str(read_property()),
    ))
