"""FAMILY 14 — a value that holds a CLASS, not an instance.

The engine types instances through every carrier — a binding, a ternary, an `or`, a
container. A CLASS travelling the same way fell out at the first hop, and the loss
compounds: the call on the class is lost, `cls` inside the classmethod is then unbound,
so the construction it performs is lost too, and with it everything downstream.

Every case below is the registry / plugin / factory shape.

On the WIDE entries this family produces: `create` is a single shared body, so `cls`
inside it really is the union of every class create is called on, and the object it
returns fans accordingly. Making `via_binding` exact would need per-call-site
sensitivity, which this engine deliberately does not do. The sets are sound and contain
the true target; what matters here is that the sites resolve at all, and that none is
WRONG.
"""
from typing import ClassVar, Dict, Type


class Element:
    @classmethod
    def create(cls):
        # deliberately UNannotated: the return type then comes from the return EXPRESSION,
        # so `cls()` types it as the exact class create was called on rather than as the
        # declared upper bound Element. That is what makes these links exact rather than
        # a sound-but-wide fan over every subclass.
        return cls()

    def render(self) -> str:
        return "element"


class Heading(Element):
    def render(self) -> str:
        return "heading"


class Para(Element):
    def render(self) -> str:
        return "para"


class Unknown(Element):
    def render(self) -> str:
        return "unknown"


def via_binding() -> str:
    kls = Heading                          # a single-write name holding a CLASS
    return kls.create().render()


def via_or(missing) -> str:
    kls = missing or Unknown               # `or` — the registry default idiom
    return kls.create().render()


def via_ternary(flag: bool) -> str:
    kls = Heading if flag else Para        # both branches are classes
    return kls.create().render()


def via_type_annotation(kls: Type[Element]) -> str:
    return kls.create().render()           # `Type[X]` HOLDS the class


class Registry:
    """A class-level dict of classes — where a registry actually lives, since the table
    is shared by every instance."""
    elements: ClassVar[Dict[str, Type[Element]]] = {"h": Heading, "p": Para}

    def build_get(self, kind: str) -> str:
        kls = self.elements.get(kind) or Unknown
        return kls.create().render()       # .get on a class-level registry

    def build_subscript(self, kind: str) -> str:
        kls = self.elements[kind]
        return kls.create().render()       # subscript on the same registry
