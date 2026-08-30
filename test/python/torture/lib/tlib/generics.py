"""FAMILY: generics. Bound, unbound, and a chained generic return."""
from typing import Generic, List, TypeVar

T = TypeVar("T")


class Payload:
    def tag(self) -> str:
        return "Payload"


class Marker:
    def tag(self) -> str:
        return "Marker"


class Box(Generic[T]):
    def __init__(self) -> None:
        self._items: List[T] = []

    def put(self, item: T) -> None:
        self._items.append(item)

    def get(self) -> T:
        return self._items[0]

    def all_of(self) -> List[T]:
        return self._items


class IntBox(Box[Payload]):
    pass


class StrBox(Box[Marker]):
    pass


class RawBox(Box):
    """T never bound -- get() must stay untyped. The control."""
