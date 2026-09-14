"""THE DIAMOND. `get_distance` is defined at every level, so which one `super()` reaches
depends on the runtime type slice and not on the writing class's bases.

MRO(Hybrid) = Hybrid, Planar, Spatial, Shape

    super().get_distance() in Hybrid  -> Planar.get_distance
    super().get_distance() in Planar  -> Spatial.get_distance  WHEN self is a Hybrid
                                      -> Shape.get_distance    when self is a Planar
    super().get_distance() in Spatial -> Shape.get_distance

The Planar case is the one a "my base class" rule gets wrong: Spatial is not a base of
Planar and appears nowhere in its bases.
"""
from abc import ABC


class Shape(ABC):
    def __init__(self, tag: str):
        self.tag = tag

    def get_distance(self) -> float:
        return 1.0


class Planar(Shape):
    def get_distance(self) -> float:
        return 2.0 + super().get_distance()


class Spatial(Shape):
    def get_distance(self) -> float:
        return 4.0 + super().get_distance()


class Hybrid(Planar, Spatial):
    def get_distance(self) -> float:
        return 8.0 + super().get_distance()


class Flat(Planar):
    """Overrides nothing — inherits Planar.get_distance."""

    def label(self) -> str:
        return "flat:" + self.tag
