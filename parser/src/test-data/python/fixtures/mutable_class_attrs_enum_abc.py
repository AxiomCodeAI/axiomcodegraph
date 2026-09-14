"""Three more class-identity edge cases: a mutable class attribute shared
across all instances (a class-level analogue of the mutable-default-arg
trap), an Enum class (whose "assignments" become members, including an
explicit alias), and an ABC with __init_subclass__."""

import enum
from abc import ABC, abstractmethod


class Basket:
    # `items` is a CLASS attribute (bound once, in the class body) even
    # though it looks exactly like an instance attribute would if it were
    # written as `self.items = []` in __init__. Every instance that never
    # reassigns `self.items` shares this one list.
    items = []
    label = "basket"

    def add(self, thing):
        # mutates the shared class-level list
        self.items.append(thing)

    def replace(self, things):
        # THIS write creates a genuine per-instance attribute that shadows
        # the class attribute from then on — same name, different field
        # identity depending on which write site you're looking at.
        self.items = list(things)


class Color(enum.Enum):
    RED = 1
    GREEN = 2
    BLUE = 3
    # an alias: same value as RED, does not create a second distinct member
    CRIMSON = 1

    @property
    def is_warm(self):
        return self in (Color.RED, Color.CRIMSON)


class Status(enum.Enum):
    PENDING = enum.auto()
    ACTIVE = enum.auto()
    DONE = enum.auto()


class Shape(ABC):
    registry = []

    def __init_subclass__(cls, **kwargs):
        # implicitly a classmethod, no decorator required — CPython adds
        # it to the class namespace before the class object even exists
        super().__init_subclass__(**kwargs)
        Shape.registry.append(cls)

    @abstractmethod
    def area(self):
        ...

    @property
    @abstractmethod
    def name(self):
        ...


class Circle(Shape):
    def __init__(self, radius):
        self.radius = radius

    def area(self):
        return 3.14159 * self.radius**2

    @property
    def name(self):
        return "circle"
