"""FAMILY 31 — blind spots that had no NAME.

`no_rule` is defined in call-edge-generation/call_chain.dl as a site that could
not be resolved AND could not be explained, and site_reason's comment states what
the difference is worth: "a blind spot you can name is a work item; one you cannot
is a mystery." Two shapes were mysteries, and between them they were the dominant
`no_rule` population on every project measured.

Nothing here is expected to RESOLVE. Every function is an `EXPECT: miss` and the
point of the family is the reason string, which expected/reasons.txt pins.
"""


class Widget:
    def render(self) -> str:
        return "W"


class Holder:
    def __init__(self) -> None:
        self.widget = Widget()

    def member_absent(self) -> int:
        # EXPECT: miss — the receiver's type is known EXACTLY and its MRO defines no
        # `__sizeof__`; the target is a C slot on `object`. Previously `no_rule`, now
        # member_absent_from_type, via the mro_lookup_absent relation that
        # resolution/attribute-lookup.dl already derived and nothing read.
        return self.widget.__sizeof__()

    def attribute_absent(self) -> str:
        # EXPECT: miss — the OBJECT (`self.widget`) is typed Widget, and `tag` is not
        # a member of Widget at all: it is installed on the instance at runtime just
        # below. The two existing attribute clauses cover "known field, unknown type"
        # and "untyped object"; this third case had no reason.
        return self.widget.tag.upper()


def drive() -> str:
    h = Holder()
    setattr(h.widget, "tag", "t")
    # Widget.render is called here and nowhere else: the family needs Widget to be a
    # REAL class with a resolvable member, or `__sizeof__` being absent from its MRO
    # would prove nothing about the lookup.
    resolved = h.widget.render()
    return f"{resolved} {h.member_absent() > 0} {h.attribute_absent()}"
