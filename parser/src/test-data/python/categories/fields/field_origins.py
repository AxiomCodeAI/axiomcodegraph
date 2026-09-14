"""Attribute declaration forms — one per fieldOrigin the schema names."""
import dataclasses
import typing


class Origins:
    class_body_assign = 1
    class_body_annotation: int
    __slots__ = ("slot_entry",)

    def __init__(self) -> None:
        self.self_assign = 2
        self.self_augassign = 0
        self.self_augassign += 1


@dataclasses.dataclass
class Point:
    x: int
    y: int = 0

    def total(self) -> int:
        return self.x + self.y


class Named(typing.NamedTuple):
    a: int
    b: str


class Typed(typing.TypedDict):
    key: int


def exercise() -> int:
    return Point(1, 2).total() + Origins().self_assign
