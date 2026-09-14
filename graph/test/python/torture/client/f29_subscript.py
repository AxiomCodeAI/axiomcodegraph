"""FAMILY 29 — `xs[i]` yields what the container holds.

resolution/iteration.dl already derived an element type for every container shape
the engine can read, and only ITERATION consumed it. So these two lines, one
annotation apart, gave different answers:

    for w in xs: w.render()   # known_edge -> Widget.render
    xs[0].render()            # ambiguous_unknown

One function per container shape, plus `slice_is_not_an_element`, which is the
control: it is the one case where reading the element would be a WRONG answer
rather than a wide one.
"""
from typing import Dict, List

from tlib.shapes import Square, squares


class Widget:
    def render(self) -> str:
        return "W"

    def count(self, _x: int) -> int:
        """Named to collide with list.count on purpose — see the slice control."""
        return 1


def make() -> List[Widget]:
    return [Widget()]


def make_map() -> Dict[str, Widget]:
    return {"k": Widget()}


def annotated_parameter(xs: List[Widget]) -> str:
    return xs[0].render()


def annotated_dict_parameter(d: Dict[str, Widget]) -> str:
    return d["k"].render()


def annotated_local() -> str:
    xs: List[Widget] = make()
    return xs[0].render()


def local_from_declared_return() -> str:
    xs = make()
    return xs[0].render()


def call_result_in_place() -> str:
    return make()[0].render()


def a_list_display() -> str:
    xs = [Widget()]
    return xs[0].render()


def a_negative_index() -> str:
    xs = make()
    return xs[-1].render()


def a_library_container() -> str:
    return squares(2)[0].name()


def widget_count_runs() -> int:
    """Widget.count has to actually EXECUTE somewhere.

    Otherwise tier 4 holds no row for it, and the slice control below could not
    tell "the engine declined to answer" apart from "the trace never saw this
    target anyway" — the control would pass for the wrong reason.
    """
    w = Widget()
    return w.count(1)


def slice_is_not_an_element() -> int:
    # EXPECT: miss — `xs[1:]` is a LIST of Widgets, not a Widget, so the element
    # type must NOT reach it. `count` is spelled on both Widget and list, so if the
    # SLICE negation in expr-type.dl were dropped this line would answer
    # Widget.count as a known_edge: a fabricated edge, not imprecision. Nothing
    # should resolve here instead, because no relation in this engine carries the
    # element type of a container of BUILTINS, which is what a slice of a list is.
    xs = make()
    return xs[1:].count(Widget())


class Holder:
    def __init__(self) -> None:
        self.xs: List[Widget] = make()
        self.shapes: List[Square] = squares(1)

    def annotated_field(self) -> str:
        return self.xs[0].render()

    def library_element_field(self) -> str:
        # EXPECT: miss — NOT a subscript gap, and verified as the pair below shows:
        # an annotation `List[LibClass]` yields NO element type at all, so iterating
        # it fails identically. resolution/iteration.dl says of its lib mirror that
        # "the others bottom out in an annotation, which resolution/annotations.dl
        # already resolves across the boundary"; that claim does not hold, because
        # type_ref_resolved is a within-parse link and the library was parsed
        # separately, so a client annotation can never resolve to a library type
        # hash. Both lines start passing when that is closed.
        return self.shapes[0].name()

    def library_element_field_iterated(self) -> str:
        # EXPECT: miss — the ITERATION half of the line above, present so the
        # fixture proves which layer is at fault instead of asserting it.
        out = []
        for sq in self.shapes:
            out.append(sq.name())
        return "".join(out)


def drive() -> str:
    h = Holder()
    return " ".join([
        annotated_parameter(make()),
        annotated_dict_parameter(make_map()),
        annotated_local(),
        local_from_declared_return(),
        call_result_in_place(),
        a_list_display(),
        a_negative_index(),
        a_library_container(),
        str(widget_count_runs()),
        str(slice_is_not_an_element()),
        h.annotated_field(),
        h.library_element_field(),
        h.library_element_field_iterated(),
    ])
