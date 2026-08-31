"""FAMILY 15 — an attribute whose object is not `self`.

Every attribute-typing rule went through expr_attr_of_self, which requires the object to
be a SELF_REFERENCE. So `self.x` was typed three ways and `anything_else.x` no way — even
where the object's type is perfectly well known. It also truncated every chain longer than
one attribute, including on self: `self.a` resolved, `self.a.b` did not.
"""


class Leaf:
    def emit(self) -> str:
        return "leaf"


class Middle:
    def __init__(self) -> None:
        self.leaf: Leaf = Leaf()               # field with its own annotation


class Holder:
    def __init__(self, middle: Middle) -> None:
        self.middle = middle                   # field typed from a PARAMETER
        self.own = Middle()                    # field typed from a CONSTRUCTION

    def via_self_two_hops(self) -> str:
        return self.middle.leaf.emit()         # chain on self, two attributes deep

    def via_self_construction(self) -> str:
        return self.own.leaf.emit()


def via_parameter(h: Holder) -> str:
    return h.middle.leaf.emit()                # object is a PARAMETER, three hops


def via_parameter_one_hop(m: Middle) -> str:
    return m.leaf.emit()                       # the minimal non-self case


def via_local(h: Holder) -> str:
    x = h.middle                               # attribute into a local, then a hop
    return x.leaf.emit()
