"""Locally resolvable IN PRINCIPLE, not yet resolved. A ratchet, not a tripwire.

Every callee here is declared in this file, so nothing external stands in the way
— these fail on inference we have not built, not on analysis scope. They are kept
apart from `resolution_edges.py` because that file is admitted to the golden
corpus and must stay at zero unresolved; this one carries an expected count that
`open-edges-gate.ts` allows to fall and never to rise.

Delete a case from here and add it there when it starts resolving.
"""


class Base:
    def name(self) -> str:
        return "base"


class Left(Base):
    def name(self) -> str:
        return "left"


class Right(Base):
    def name(self) -> str:
        return "right"


class Property:
    """Return type is annotated; the receiver is a property call."""

    def __init__(self) -> None:
        self._inner = Base()

    @property
    def inner(self) -> Base:
        return self._inner


def aliased_callable() -> str:
    """A CLASS bound to a local, then constructed through the alias."""
    alias = Base
    return alias().name()


def conditional_binding(flag: bool) -> str:
    """Two writes on two branches: the receiver is a union of Left and Right."""
    if flag:
        target = Left()
    else:
        target = Right()
    return target.name()


def reassigned() -> str:
    """Two writes in sequence; the live type at the call is the second."""
    value = Left()
    value = Right()
    return value.name()


def through_property() -> str:
    return Property().inner.name()


def from_container() -> str:
    """Element type of a homogeneous literal list."""
    items = [Left(), Left()]
    return items[0].name()


def from_return_flow() -> str:
    """Receiver is the result of a call whose return type is annotated."""

    def make() -> Base:
        return Base()

    return make().name()
