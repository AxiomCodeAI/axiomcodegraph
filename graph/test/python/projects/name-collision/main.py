"""Runnable, so CPython can say what actually happened."""
from typing import List

from geometry.shapes import Flat, Hybrid, Planar, Spatial
from journey import Journey, Leg, concrete_calls, through_annotation, untyped, via_protocol
from metrics.distance import (Chebyshev, Euclidean, Manhattan, Point,
                              RegisteredEuclidean, Scaled, by_name)
from transit.modes import Bus, Ferry, Train


def main() -> None:
    print("concrete", concrete_calls())

    shapes: List[Planar] = [Planar("p"), Hybrid("h"), Flat("f")]
    for metric in (Euclidean(), Manhattan(), Chebyshev(), Scaled(3.0), RegisteredEuclidean()):
        journey = Journey(shapes, metric)
        print(type(metric).__name__, journey.shape_total(), journey.one_hop((0.0, 0.0), (1.0, 2.0)))
        print("  total", journey.metric_total([(0.0, 0.0), (1.0, 1.0), (2.0, 4.0)]))

    # Spatial is constructed too, so `shape: Shape` legitimately widens to include it.
    print("spatial", Spatial("s").get_distance())

    print("leg", Leg(Bus(3)).length())
    print("annotated", through_annotation(Hybrid("h"), Bus(2), Manhattan(), (0.0, 0.0), (1.0, 1.0)))
    print("registry", by_name("euclid", (0.0, 0.0), (3.0, 4.0)))

    # The controls: real calls whose receiver the text does not type.
    print("untyped", untyped(Ferry()), untyped(Train(2.0)))
    print("protocol", via_protocol(Bus(1)))


if __name__ == "__main__":
    main()
