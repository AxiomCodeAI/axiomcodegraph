"""Generics and structural typing — the two things a Java-shaped resolver gets wrong.

`Repository` is Generic[T] AND abstract, so `Repository[Item]` is a SUBSCRIPT base whose
runtime base is the subscripted class, not the subscript. `Identifiable` is a Protocol:
nothing declares it as a base, so any resolution through it has to be structural or
honestly unknown.
"""
from abc import ABC, abstractmethod
from typing import Generic, Iterable, List, Optional, Protocol, TypeVar

T = TypeVar("T")
K = TypeVar("K")


class Identifiable(Protocol):
    """Structural. No class below names it as a base."""

    def identity(self) -> str:
        ...


class Repository(Generic[T], ABC):
    """Abstract, generic, and with a TEMPLATE METHOD.

    `add_all` calls `self.add`, which is abstract here — so the target lives in whichever
    subclass the receiver actually is. That is the polymorphic call the engine has to
    either resolve to a bounded set or declare unknown.
    """

    @abstractmethod
    def add(self, item: T) -> str:
        ...

    @abstractmethod
    def get(self, key: str) -> Optional[T]:
        ...

    def add_all(self, items: Iterable[T]) -> List[str]:
        return [self.add(item) for item in items]

    def get_all(self, keys: Iterable[str]) -> List[T]:
        found = []
        for key in keys:
            item = self.get(key)
            if item is not None:
                found.append(item)
        return found


class Countable(Protocol):
    def count(self) -> int:
        ...
