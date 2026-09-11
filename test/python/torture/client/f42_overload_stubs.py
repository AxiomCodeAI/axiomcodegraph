"""FAMILY 42 — an @overload declaration is not a call target (issue #376).

`@overload def f(...)` registers a SIGNATURE with typing and the following `def f`
rebinds the name, so the stub objects are discarded before any call can reach one.
Verified against the interpreter rather than assumed: `inspect.unwrap(described)`
reports the implementation's line, and over a run `sys.setprofile` records the
implementation and nothing at the declarations.

The gate for this already existed — `method_body_is_stub`, whose own comment says a
stub MUST NEVER BE A CALL TARGET — but it sat on the class-member route only. A
module-level function is not reached through `type_defines_method`, so a module-level
overload set came out a three-way multi_inferred of which two members have no body.

WHAT THE TEST IS, and why this family is not one function. `bodyIsStub` is true of ANY
body that is only `...`, `pass` or a docstring, so the flag alone cannot separate an
overload declaration from a no-op the program really calls. What separates them is the
BINDING: the parser puts all three `described` declarations on one
declaringBindingLinkHash, and a non-stub `def` sharing that binding is what rebound the
name. `deliberate_noop` below has no such sibling and must stay a target — it is the
control, and a blanket `!method_body_is_stub` on the name route would delete its edge.
"""
from typing import overload


@overload
def described(x: int) -> str: ...
@overload
def described(x: str) -> str: ...
def described(x) -> str:
    """The only callable object this name ever denotes."""
    return "impl:" + str(x)


def deliberate_noop() -> None:
    """THE CONTROL. bodyIsStub is true here and the edge to it is correct.

    A module-level no-op is a real function CPython really calls; nothing rebound
    this name. The site must stay a known_edge.
    """


class Formatter:
    """The class-member route, which has had the gate since the beginning.

    Here as a REGRESSION GUARD rather than a new claim: whatever the module-level
    route does, a class-level overload set must keep resolving to the one method
    with a body, and the golden pins it.
    """

    @overload
    def render(self, v: int) -> str: ...
    @overload
    def render(self, v: str) -> str: ...
    def render(self, v) -> str:
        return "render:" + str(v)


def overload_set_is_one_target() -> str:
    """Both sites resolve to the implementation alone, not to the declarations."""
    return described(1) + described("a")


def no_op_is_still_a_target() -> None:
    """The control's call site."""
    deliberate_noop()


def method_overload_set_is_one_target() -> str:
    """The class-member route, unchanged by this fix and pinned against regression."""
    return Formatter().render(7)


def drive() -> str:
    return " ".join((
        overload_set_is_one_target(),
        str(no_op_is_still_a_target()),
        method_overload_set_is_one_target(),
    ))
