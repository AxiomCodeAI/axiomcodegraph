"""FAMILY 30 — a container of BUILTINS.

The largest element-type gap, and a missing RELATION rather than a missing clause:
element_type_of carried class elements and element_lib_type_of carried library
ones, and nothing carried builtin ones. So every line here resolved to nothing,
iterating and indexing alike — including a list of string LITERALS, where the
element type is a certainty the parser already marked CERTAIN.

Measured share, which is why it earned its own relation: of 4,966 generic
arguments of container annotations across five open-source projects, the element
named is a builtin 49.4% of the time and a class defined in the project 11.7%.

`a_mapping_iterated` and `a_mapping_indexed` are the pair that matters most.
Iterating a mapping yields KEYS and subscripting it yields VALUES, so they must
give DIFFERENT answers off one annotation. Emitting both arguments to both would
be sound for a class element and is not here: str shares count/index/find/replace
with bytes and int, so a spurious member would not self-prune at lookup.
"""
from typing import Dict, List, Set


def annotated_parameter(names: List[str]) -> str:
    out = ""
    for n in names:
        out += n.upper()
    return out


def annotated_parameter_indexed(names: List[str]) -> str:
    return names[0].upper()


def a_mapping_iterated(d: Dict[str, int]) -> str:
    out = ""
    for k in d:
        out += k.upper()          # KEYS -> str
    return out


def a_mapping_indexed(d: Dict[str, bytes]) -> str:
    return d["k"].decode()        # VALUES -> bytes


def a_sequence_alias(names: Set[str]) -> str:
    out = ""
    for n in names:
        out += n.strip()
    return out


def a_declared_return() -> str:
    return make_names()[0].title()


def make_names() -> List[str]:
    return ["a", "b"]


def an_annotated_local() -> str:
    xs: List[str] = ["c", "d"]
    return xs[0].casefold()


def a_display_of_literals() -> str:
    xs = ["e", "f"]
    out = ""
    for x in xs:
        out += x.swapcase()
    return out


def a_nested_container(d: Dict[str, Set[str]]) -> int:
    d["k"].add("v")               # the VALUE is itself a container
    return len(d)


def slice_of_a_builtin_container(names: List[str]) -> int:
    # EXPECT: miss — `names[1:]` is a LIST of strs, not a str. `count` is spelled on
    # both list and str, so if subscript_reads_element stopped excluding a SLICE this
    # line would answer builtin:str.count on a list receiver. Nothing should resolve:
    # a slice's own type is list, and no relation here carries "the container type of
    # a slice of a container".
    return names[1:].count("x")


class Holder:
    def __init__(self) -> None:
        self.names: List[str] = ["g"]
        self.lookup: Dict[str, bytes] = {"h": b"i"}

    def annotated_field_iterated(self) -> str:
        out = ""
        for n in self.names:
            out += n.upper()
        return out

    def annotated_field_indexed(self) -> str:
        return self.lookup["h"].decode()


def through_any_object(h: Holder) -> str:
    return h.names[0].upper()     # the field hop through a non-self object


def drive() -> str:
    h = Holder()
    return " ".join([
        annotated_parameter(["j"]),
        annotated_parameter_indexed(["k"]),
        a_mapping_iterated({"l": 1}),
        a_mapping_indexed({"k": b"m"}),
        a_sequence_alias({"n"}),
        a_declared_return(),
        an_annotated_local(),
        a_display_of_literals(),
        str(a_nested_container({"k": set()})),
        str(slice_of_a_builtin_container(["o", "p"])),
        h.annotated_field_iterated(),
        h.annotated_field_indexed(),
        through_any_object(h),
    ])
