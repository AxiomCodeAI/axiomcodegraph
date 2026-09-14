"""FAMILY 35 — a SUBSCRIPTED member inside a PEP 604 union: `Payload[str] | None`.

This family was added when that one spelling was the only annotation shape whose head
type could not be read off `py_type_reference` at all. Its four neighbours arrived
structured and it did not:

    Payload | None            UNION_PEP604  2 children   isOptional=true
    Optional[Payload]         OPTIONAL      1 child      isOptional=true
    Optional[Payload[str]]    OPTIONAL      1 child (SUBSCRIPT, FK resolved)
    Payload[str]              SUBSCRIPT     1 child,     FK resolved
    Payload[str] | None       UNKNOWN       NO children, typeName EMPTY   <- was

so `annotation_single_name_kind` could not see it, `annotation_optional_kind` could not
see it, and no GENERIC_ARGUMENT child existed to take an element from. The only thing
that yielded `Payload` was `parameterBaseType` / `fieldBaseType` — the annotation
truncated at the first `[` — which held for the parameter and the field and NOT for the
return, whose `returnTypeName` is untruncated. That asymmetry was the finding, and the
return case was a declared miss.

AxiomCodeAI/parser#148 CLOSED IT. The union now arrives as `UNION_PEP604` with one
`GENERIC_ARGUMENT` child per operand, the subscripted operand as a `SUBSCRIPT` child
carrying its own resolved FK, in all three positions. Every case below resolves from the
type-reference table alone, the entity-column clauses that used to carry two of them are
deleted, and the return case is no longer marked miss.

SO THE FAMILY STAYS AS THE GUARD ON THAT ROUTE, which is the only reason it is still
here: if the union ever stops being decomposed, or the head FK stops resolving, these
seven cases go ambiguous_unknown and nothing else in the suite notices.

EVERY VALUE COMES OUT OF `_from_bag`, WHICH IS UNANNOTATED, so the annotation is the
only thing that can type it. Handing `Payload()` in directly would let argument flow
supply the answer and the annotation would never be consulted — an earlier draft of
this file did exactly that and passed with the annotation rules removed.

`| None` is deliberate throughout — the shape only collapsed when a subscript was a
union OPERAND, so a union that is not optional would not exercise it. The
`plain`/`Optional[...]` twins are controls: same type, same position, a spelling that
always worked, so a failure here is attributable to the union operand and not to
generics.
"""
from typing import Generic, Optional, TypeVar

T = TypeVar("T")

_BAG = {}


class Payload(Generic[T]):
    def __init__(self) -> None:
        self.tag = "payload"

    def render(self) -> str:
        return self.tag


def _from_bag(key):
    # Unannotated in and out, reached by a computed subscript: the engine cannot
    # recover a type from this, which is the point.
    return _BAG[key]


class Holder:
    def __init__(self) -> None:
        # FIELD position.
        self.subscripted: Payload[str] | None = _from_bag("s")
        # Control: a union of plain names, which arrives as UNION_PEP604.
        self.plain: Payload | None = _from_bag("p")

    def read_subscripted(self) -> str:
        return self.subscripted.render()

    def read_plain(self) -> str:
        return self.plain.render()


def param_subscripted_union(p: Payload[str] | None) -> str:
    # PARAMETER position.
    return p.render()


def param_plain_union(p: Payload | None) -> str:
    return p.render()


def param_optional_subscript(p: Optional[Payload[str]]) -> str:
    # The SAME TYPE spelled with Optional[...], which does arrive structured. Its
    # presence is what shows the gap is the `|` spelling and not generics.
    return p.render()


def _make_subscripted() -> Payload[str] | None:
    # RETURN position — the one the entity route could never reach.
    return _from_bag("s")


def _make_plain() -> Payload | None:
    return _from_bag("p")


def return_subscripted_union() -> str:
    # This was the declared blind spot: `returnTypeName` holds the whole
    # `Payload[str] | None`, so no name lookup matched and the return position had no
    # fallback at all. parser#148 decomposes the union here too, so the head now comes
    # off the SUBSCRIPT child's own FK and the marker is gone.
    return _make_subscripted().render()


def return_plain_union() -> str:
    return _make_plain().render()


def drive() -> str:
    _BAG["s"] = Payload()
    _BAG["p"] = Payload()
    h = Holder()
    parts = [
        h.read_subscripted(),
        h.read_plain(),
        param_subscripted_union(_from_bag("s")),
        param_plain_union(_from_bag("p")),
        param_optional_subscript(_from_bag("s")),
        return_subscripted_union(),
        return_plain_union(),
    ]
    return " ".join(parts)
