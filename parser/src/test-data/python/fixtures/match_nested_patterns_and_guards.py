"""Second match/case fixture: nesting depth, splat position variants, and
guards that reference multiple pattern-bound names — deliberately different
shapes from match_class_and_sequence_patterns.py rather than repeats.
"""

from dataclasses import dataclass


@dataclass
class Event:
    kind: str
    payload: dict


@dataclass
class Command:
    name: str
    args: tuple


def handle(msg):
    match msg:
        case Event(kind="click", payload={"x": x, "y": y, **rest}) if x >= 0 and y >= 0:
            # class_pattern whose keyword_pattern value is itself a dict_pattern;
            # `rest` is the dict_pattern's splat capture; guard is a boolean `and`
            # over two names the pattern just bound
            return ("click", x, y, rest)
        case Event(kind="scroll" | "wheel", payload=payload):
            # union_pattern as the value of a keyword_pattern
            return ("scroll", payload)
        case Command(name=name, args=(first, *middle, last)):
            # keyword_pattern whose value is a tuple sequence pattern with a
            # splat in the *middle* position, not at the start or end
            return (name, first, middle, last)
        case Command(name=name, args=()):
            # empty sequence pattern — no elements, no bindings from args
            return (name, "no-args")
        case [Event(kind=k1) as e1, Event(kind=k2) as e2, *others]:
            # list_pattern of two as_patterns (each wrapping a class_pattern)
            # followed by a splat capturing the remainder
            return (k1, e1, k2, e2, others)
        case {"batch": [*events], "meta": {"source": source, **meta_rest}}:
            # dict_pattern whose values are a sequence pattern and a nested
            # dict_pattern, each with their own splat capture
            return (events, source, meta_rest)
        case str() as s if len(s) > 0:
            return ("nonempty-string", s)
        case (int() | float()) as n:
            # as_pattern wrapping a union_pattern of two bare class_patterns
            return ("number", n)
        case None:
            return "nothing"
        case _:
            return "unhandled"


def classify_point3(triple):
    match triple:
        case (0, 0, 0):
            return "origin"
        case (x, y, z) if x == y == z:
            return "diagonal", x
        case (*head, last):
            # splat at the front, single capture at the end
            return head, last
        case _:
            return None
