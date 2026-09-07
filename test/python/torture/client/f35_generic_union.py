"""FAMILY 35 — a SUBSCRIPTED member inside a PEP 604 union: `Payload[str] | None`.

This family exists because that one spelling is the only annotation shape whose head
type reaches the engine ONLY through the entity columns. Measured on the type
reference table, the four neighbouring spellings all arrive structured and the fifth
does not:

    Payload | None            UNION_PEP604  2 children   isOptional=true
    Optional[Payload]         OPTIONAL      1 child      isOptional=true
    Optional[Payload[str]]    OPTIONAL      1 child (SUBSCRIPT, FK resolved)
    Payload[str]              SUBSCRIPT     1 child,     FK resolved
    Payload[str] | None       UNKNOWN       NO children, typeName EMPTY

So `annotation_single_name_kind` cannot see it, `annotation_optional_kind` cannot see
it, and no GENERIC_ARGUMENT child exists to take an element from. What DOES see it is
`parameterBaseType` / `fieldBaseType`, which are the annotation truncated at the first
`[` — `Payload` — and truncation happens to be right here.

That makes the entity-column clauses in resolution/annotations.dl load-bearing rather
than legacy, which is the opposite of what issue #47 assumed, and the reason this file
is a fixture and not a comment: without those clauses the parameter and the field below
go ambiguous_unknown, and nothing else in the suite notices.

THE RETURN POSITION HAS NO SUCH FALLBACK. `returnTypeName` is NOT truncated — it holds
`Payload[str] | None` whole — so no name lookup matches and the return case is a genuine
blind spot, marked below. Two of the three positions are carried by a column the third
does not have, which is why all three are here: the asymmetry is the finding.

EVERY VALUE COMES OUT OF `_from_bag`, WHICH IS UNANNOTATED, so the annotation is the
only thing that can type it. Handing `Payload()` in directly would let argument flow
supply the answer and the annotation would never be consulted — an earlier draft of
this file did exactly that and passed with the annotation rules removed.

`| None` is deliberate throughout — the shape only collapses when a subscript is a
union OPERAND, so a union that is not optional would not exercise it. The
`plain`/`Optional[...]` twins are controls: same type, same position, structured
annotation, so a failure here is attributable to the spelling and not to generics.
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
        # FIELD position. fieldBaseType is `Payload`; the type reference is UNKNOWN.
        self.subscripted: Payload[str] | None = _from_bag("s")
        # Control: a union of plain names, which arrives as UNION_PEP604.
        self.plain: Payload | None = _from_bag("p")

    def read_subscripted(self) -> str:
        return self.subscripted.render()

    def read_plain(self) -> str:
        return self.plain.render()


def param_subscripted_union(p: Payload[str] | None) -> str:
    # PARAMETER position. parameterBaseType is `Payload`, kind is UNKNOWN.
    return p.render()


def param_plain_union(p: Payload | None) -> str:
    return p.render()


def param_optional_subscript(p: Optional[Payload[str]]) -> str:
    # The SAME TYPE spelled with Optional[...], which does arrive structured. Its
    # presence is what shows the gap is the `|` spelling and not generics.
    return p.render()


def _make_subscripted() -> Payload[str] | None:
    # RETURN position. returnTypeName is `Payload[str] | None`, so the entity route
    # truncates to `Payload`; the type reference is UNKNOWN.
    return _from_bag("s")


def _make_plain() -> Payload | None:
    return _from_bag("p")


def return_subscripted_union() -> str:
    # EXPECT: miss — returnTypeName is the whole `Payload[str] | None`, not truncated,
    # so neither route resolves a head type. Closing it needs the parser to decompose
    # the union (AxiomCodeAI/parser#141); nothing the engine can key on exists today.
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
