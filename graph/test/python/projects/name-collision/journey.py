"""Call sites, each with the receiver typed a DIFFERENT way, so every mechanism is
exercised against the same colliding name.

Every `get_distance()` below would have the full name fan as its candidate set under
name-based resolution. The point of the case is what each one narrows to.
"""
from typing import Any, Dict, List, Optional, Protocol, Tuple

from geometry.shapes import Flat, Hybrid, Planar, Shape, Spatial
from metrics.distance import Euclidean, Manhattan, Metric, Point, Scaled
from transit.modes import Bike, Bus, Ferry, Train, Walk


class Movable(Protocol):
    """Structural. Nothing declares it as a base, so a receiver typed only as this is a
    declared unknown — there is no hierarchy to search."""

    def get_distance(self) -> float:
        ...


class Leg:
    """A leg wraps ONE transit mode. `self.mode` is typed by the constructor annotation."""

    def __init__(self, mode: Bus):
        self.mode = mode

    def length(self) -> float:
        return self.mode.get_distance()          # field <- annotated parameter


class Journey:
    def __init__(self, shapes: List[Planar], metric: Metric):
        self.shapes = shapes
        self.metric = metric

    def shape_total(self) -> float:
        # comprehension target over List[Planar] -> the Planar hierarchy only
        return sum(s.get_distance() for s in self.shapes)

    def metric_total(self, points: List[Point]) -> float:
        return self.metric.total(points)         # field <- annotated parameter

    def one_hop(self, a: Point, b: Point) -> float:
        return self.metric.get_distance(a, b)    # the two-arg name, same spelling


def concrete_calls() -> float:
    # Receiver typed by CONSTRUCTION: each must reach exactly one definition.
    running = 0.0
    running += Bus(4).get_distance()
    running += Train(12.5).get_distance()
    running += Ferry().get_distance()
    running += Bike().get_distance()
    running += Walk().get_distance()
    running += Hybrid("h").get_distance()
    running += Flat("f").get_distance()
    running += Euclidean().get_distance((0.0, 0.0), (3.0, 4.0))
    running += Scaled(2.0).get_distance((0.0, 0.0), (1.0, 1.0))
    return running


def through_annotation(shape: Shape, mode: Bus, metric: Metric,
                       a: Point, b: Point) -> float:
    # Receivers typed by ANNOTATION. `shape: Shape` is the widest -- every constructed
    # Shape subclass is a candidate -- while `mode: Bus` has no subclasses at all.
    return shape.get_distance() + mode.get_distance() + metric.get_distance(a, b)


def untyped(x) -> float:
    """THE CONTROL. No annotation, no flow, no construction. There are fifteen
    `get_distance` definitions in this project and the honest answer is none of them:
    ambiguous_unknown. An engine that answers fifteen here is guessing."""
    return x.get_distance()


def via_protocol(m: Movable) -> float:
    """Also a control: a Protocol is structural, so there is no hierarchy to search and
    no class declares it. Declared unknown, not a fan over everything with the name."""
    return m.get_distance()
