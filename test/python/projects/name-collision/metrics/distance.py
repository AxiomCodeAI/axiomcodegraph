"""A fourth hierarchy, ALSO called get_distance, with a real base and a two-arg signature.
Same name, different arity, different hierarchy — so arity alone cannot separate them
either.
"""
from abc import ABC, abstractmethod
from typing import Dict, List, Tuple, Type

Point = Tuple[float, float]


class Metric(ABC):
    @abstractmethod
    def get_distance(self, a: Point, b: Point) -> float:
        ...

    def total(self, points: List[Point]) -> float:
        # Template method over the abstract call: the target is in whichever subclass the
        # receiver actually is.
        running = 0.0
        for i in range(len(points) - 1):
            running += self.get_distance(points[i], points[i + 1])
        return running


class Euclidean(Metric):
    def get_distance(self, a: Point, b: Point) -> float:
        return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


class Manhattan(Metric):
    def get_distance(self, a: Point, b: Point) -> float:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])


class Chebyshev(Metric):
    def get_distance(self, a: Point, b: Point) -> float:
        return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


class Scaled(Euclidean):
    def __init__(self, factor: float):
        self.factor = factor

    def get_distance(self, a: Point, b: Point) -> float:
        # super() through a SINGLE-inheritance chain: Scaled -> Euclidean -> Metric
        return self.factor * super().get_distance(a, b)


REGISTRY: Dict[str, Type[Metric]] = {}


def register(name: str):
    def keep(cls):
        REGISTRY[name] = cls
        return cls

    return keep


@register("euclid")
class RegisteredEuclidean(Euclidean):
    def get_distance(self, a: Point, b: Point) -> float:
        return super().get_distance(a, b)


def by_name(name: str, a: Point, b: Point) -> float:
    cls = REGISTRY[name]
    return cls().get_distance(a, b)
