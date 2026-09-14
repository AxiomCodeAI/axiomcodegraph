"""FAMILY 08 — genuinely dynamic. Most of these SHOULD miss; they are here so the
blind spots stay measured rather than assumed."""
from tlib import Circle, Square


def dict_dispatch_static_key() -> str:
    table = {"sq": Square, "ci": Circle}
    return table["sq"]().name()         # static literal key -> resolvable


def dict_dispatch_computed_key(k: str) -> str:
    # EXPECT: miss  key is a parameter
    table = {"sq": Square, "ci": Circle}
    return table[k]().name()


def getattr_call(obj) -> str:
    # EXPECT: miss  computed attribute name
    return getattr(obj, "name")()


def conditional_type(flag: bool) -> str:
    obj = Square() if flag else Circle()   # union of two constructions
    return obj.name()
