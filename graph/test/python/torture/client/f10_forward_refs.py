"""FAMILY 10 — PEP 484 STRING FORWARD REFERENCES.

A quoted annotation is legal wherever a bare one is, and is the ONLY way to annotate
against a class imported under `if TYPE_CHECKING:` — the standard cure for an import
cycle. Every case here is an annotation the engine can read; the only question is
whether the quotes stop it matching the class name.

Two spellings, because a base type is taken by truncating at the first `[`:
    "Holder"            both quotes survive
    "Optional[Holder]"  truncates to `"Optional` — LEADING QUOTE ONLY
Requiring a balanced pair silently skips the second, so both are exercised.
"""
from typing import TYPE_CHECKING, List, Optional

from tlib.shapes import Base

if TYPE_CHECKING:                     # never imported at runtime — quotes are mandatory
    from tlib.shapes import Mid


class Holder:
    def tag(self) -> str:
        return "Holder"


class Boxed:
    """A quoted annotation on a FIELD."""
    def __init__(self, inner: "Holder") -> None:
        self.inner: "Holder" = inner

    def read(self) -> str:
        return self.inner.tag()       # field typed by a quoted annotation


def quoted_param(h: "Holder") -> str:
    return h.tag()                    # parameter typed by a quoted annotation


def single_quoted_param(h: 'Holder') -> str:
    return h.tag()                    # the ' spelling is equally legal


def quoted_return() -> "Holder":
    return Holder()


def uses_quoted_return() -> str:
    return quoted_return().tag()      # receiver typed by a quoted RETURN


def quoted_optional(h: "Optional[Holder]") -> str:
    # base truncates to `"Optional` — the unbalanced-quote spelling
    return h.tag() if h is not None else "none"


def quoted_lib_param(b: "Base") -> str:
    return b.name()                   # quoted annotation naming a LIBRARY class


def type_checking_only_param(m: "Mid") -> str:
    # `Mid` exists ONLY under TYPE_CHECKING, so nothing but the annotation names it
    return m.name()


def quoted_generic_element(items: "List[Holder]") -> str:
    # EXPECT: miss — the WHOLE annotation is one quoted string, so the parser emits no
    # GENERIC_ARGUMENT inside it and there is no inner name to resolve. Unquoting cannot
    # reach this; it is recorded so the blind spot is countable rather than absorbed.
    return "".join(i.tag() for i in items)
