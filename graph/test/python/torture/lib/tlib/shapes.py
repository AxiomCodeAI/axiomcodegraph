"""FAMILY: inheritance, MRO, super(). Every override sits at a known depth."""
from typing import List


class Base:
    def name(self) -> str:
        return "Base"

    def only_base(self) -> str:
        return "Base.only_base"

    def template(self) -> str:
        return "T(" + self.name() + ")"


class Mid(Base):
    def name(self) -> str:
        return "Mid"


class Skip(Mid):
    pass


class Leaf(Skip):
    def name(self) -> str:
        return "Leaf"

    def via_super(self) -> str:
        return "Leaf/" + super().name()


class Square(Base):
    def name(self) -> str:
        return "Square"


class Circle(Base):
    def name(self) -> str:
        return "Circle"


class DiamondL(Base):
    def name(self) -> str:
        return "DiamondL"


class DiamondR(Base):
    def name(self) -> str:
        return "DiamondR"


class Diamond(DiamondL, DiamondR):
    def both(self) -> str:
        return "D/" + super().name()


def squares(n: int) -> List[Square]:
    """A library function whose declared return is a CONTAINER, not a scalar.

    The client half is f16_element_types.via_library_container_return. Both halves
    are needed because the two sides of the asymmetry live in different relations:
    a declared scalar return reaches call_returns_lib_type, a declared container
    return had to reach element_lib_type_of and nothing carried it there.
    """
    return [Square() for _ in range(n)]
