"""FAMILY 09 — cases built to BREAK a plausible shortcut, not to exercise a feature.

Each has a reading a name-matching or single-write resolver gets wrong, and the
correct answer differs from that reading.

THE DISCRIMINATING CALL IS ALWAYS IN CLIENT CODE. A first version of this file put
the interesting dispatch inside the library -- an attribute rebound in tlib, an
override of an inherited method in tlib -- and every case passed without testing
anything, because those are lib->lib links the engine does not traverse when the
library is staged as signatures. The trap has to sit where the engine reasons.
"""
from tlib import Doubler, Mid, Square, Tripler


class Shadow:
    def run(self) -> str:
        return "Shadow.run"


class Unrelated:
    def run(self) -> str:            # same name, unrelated class
        return "Unrelated.run"


class Overrider(Mid):
    """Overrides `name`, which Mid INHERITS from Base rather than declares."""

    def name(self) -> str:
        return "Overrider.name"


class Rebound:
    """self.op is written TWICE. Typing it from the first write dispatches to
    Doubler; the live value is a Tripler."""

    def __init__(self) -> None:
        self.op = Doubler()
        self.op = Tripler()

    def use(self) -> int:
        return self.op(10)           # Tripler.__call__, never Doubler's


def shadowed_method_name() -> str:
    """Two unrelated classes declare `run`. Name matching links both; the
    receiver's type admits exactly one each."""
    return Shadow().run() + Unrelated().run()


def override_of_an_inherited_method() -> str:
    """Walking to the first class that MENTIONS `name` finds Base; the MRO finds
    Overrider, which is what runs."""
    return Overrider().name()


def inherited_through_a_silent_class() -> str:
    """Mid declares no `only_base`; it comes from Base. The receiver is a client
    subclass of a LIBRARY class, so the walk crosses the boundary."""
    return Overrider().only_base()


def rebound_attribute() -> int:
    return Rebound().use()


def shadowed_against_a_library_name() -> str:
    """`name` is declared by Square in the library AND by Overrider here. The
    receiver decides which, and they are on opposite sides of the boundary."""
    return Square().name() + Overrider().name()
