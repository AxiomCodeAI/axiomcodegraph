"""FAMILY 03 — generics: bound, unbound, chained return."""
from tlib import IntBox, Marker, Payload, RawBox, StrBox
from tlib.generics import Plain


def bound_generic() -> str:
    b = IntBox()
    b.put(Payload())
    return b.get().tag()                # get() -> T=Payload -> Payload.tag


def bound_generic_other() -> str:
    b = StrBox()
    b.put(Marker())
    return b.get().tag()                # same method, different binding


def chained_generic() -> str:
    b = IntBox()
    b.put(Payload())
    return b.get().tag()                # construction -> get() -> T -> .tag


def unbound_generic():
    # EXPECT: miss  T is never bound, so get() is correctly untyped
    r = RawBox()
    r.put(Payload())
    return r.get()


def class_named_like_a_typevar() -> str:
    """`Plain.make() -> T` names a CLASS, not Box's type parameter. If the engine
    treats every bare `-> T` as a variable this resolves to nothing or to the wrong
    thing; it must resolve to T.marker."""
    return Plain().make().marker()
