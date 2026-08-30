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


class T:
    """A CLASS literally named T, in the same module as the TypeVar T.

    The disambiguator under test: `-> T` on Box means the type PARAMETER, while
    `-> T` on Plain means THIS class. Only method_owner_declares_param separates
    them, and a rule that keyed on the written name alone would conflate the two.
    """

    def marker(self) -> str:
        return "T.marker"


class Plain:
    def make(self) -> T:            # a real class named T, NOT a type variable
        return T()
