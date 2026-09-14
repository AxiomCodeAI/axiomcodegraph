"""Every context in which a type is named."""
import typing


class Base:
    def label(self) -> str:
        return "base"


class Sub(Base):
    pass


ALIAS = typing.List[int]


def annotated(a: Base, b: "Sub", c: typing.Optional[Base] = None) -> Base:
    local: Base = a
    return local


def narrowing(x: object) -> bool:
    # isinstance is what produces the NARROWING type reference. Calling through
    # the narrowed name would additionally require the engine to APPLY the
    # narrowing, which is layer-4 work and not what this file tests.
    return isinstance(x, Base)


def casting(x: object) -> object:
    # typing.cast referenced for its CAST type reference; not called, since the
    # callee is outside the root.
    return typing.cast


class LocalError(Exception):
    """Declared in-root so `raise LocalError(...)` resolves; a bare ValueError()
    is a builtin the parser does not currently flag as one (filed for A3), which
    would cost this file its place in the golden corpus."""


def raises_and_catches() -> str:
    try:
        raise LocalError("x")
    except (LocalError, TypeError) as exc:
        return "caught"


def generics(items: typing.List[Base], mapping: typing.Dict[str, Base]) -> typing.Iterator[Base]:
    return iter(items)


def exercise() -> str:
    subject = Sub()
    return subject.label()
