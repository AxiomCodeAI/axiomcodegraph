"""Five UNRELATED classes, same method name, no shared base at all. A name-keyed resolver
has five candidates for every `x.get_distance()` in this file's vicinity and no way to
choose. Nothing here inherits from anything in geometry, metrics or legacy.
"""


class Bus:
    def __init__(self, stops: int):
        self.stops = stops

    def get_distance(self) -> float:
        return self.stops * 1.5


class Train:
    def __init__(self, km: float):
        self.km = km

    def get_distance(self) -> float:
        return self.km


class Ferry:
    def get_distance(self) -> float:
        return 30.0


class Bike:
    def get_distance(self) -> float:
        return 7.5


class Walk:
    def get_distance(self) -> float:
        return 1.2
