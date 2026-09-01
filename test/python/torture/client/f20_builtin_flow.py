"""FAMILY 20 — a builtin type surviving a method call and a non-self attribute.

Two hops lost a builtin type entirely. A builtin call is a NAMED BOUNDARY, not a client
edge, so what this buys is an accurate answer where there was none — and a receiver typed
as `str` stops other rules speculating about it.

The catalogue is deliberately partial: a member whose return is an ELEMENT of the
container (`list.pop`, `dict.get`) is left out rather than guessed, because asserting a
builtin there would be a fabrication. A missing member costs a name; a wrong one costs a
wrong answer.
"""


class Holder:
    def __init__(self) -> None:
        self.name: str = "x"
        self.items: list = []


def chained_str(key: str) -> str:
    # the first hop typed before; the second did not
    return key.strip("_").lower().replace("-", "_")


def split_then_index(text: str) -> str:
    parts = text.split(",")          # str.split -> list
    return parts[0]


def local_keeps_type(text: str) -> str:
    cleaned = text.strip()           # a local assigned from a builtin method call
    return cleaned.upper()


def non_self_attribute(h: Holder) -> str:
    # the object is a PARAMETER, not self — clause (c) required a SELF_REFERENCE
    return h.name.upper()


def non_self_attribute_container(h: Holder) -> list:
    return h.items.copy()


class UsesSelf:
    def __init__(self) -> None:
        self.label: str = "y"

    def via_self(self) -> str:
        # the case that already worked, kept so a regression here is visible
        return self.label.lower()
