"""FAMILY 06 — value flow: params, returns, attributes, containers."""
from tlib import Circle, Doubler, Square


def takes_annotated(s: Square) -> str:
    return s.name()                     # param typed by annotation


def takes_unannotated(s) -> str:
    # EXPECT: miss  no annotation and no intraprocedural evidence
    return s.name()


def returns_instance() -> Square:
    return Square()


def uses_return() -> str:
    return returns_instance().name()    # declared return type -> dispatch


def passes_through() -> str:
    return takes_annotated(Square())


def list_of_instances() -> str:
    items = [Square(), Circle()]
    return "".join(i.name() for i in items)   # element type of a literal list


def augmented_flow() -> int:
    total = 0
    d = Doubler()
    for i in (1, 2):
        total += d(i)                   # AUGMENTED_ASSIGNMENT carrying a call
    return total
