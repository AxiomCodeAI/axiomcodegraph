"""A DIAMOND, and the reason C3 is not optional.

    Entity
   /      \
Timestamped  Auditable
   \      /
    Record

`super().describe()` written in Timestamped reaches Auditable.describe when self is a
Record — and Auditable is NOT a base of Timestamped and appears nowhere in its bases. A
DFS linearisation answers Entity.describe here and is wrong. Every service's domain type
inherits Record, so the whole project sits on top of this.
"""
from abc import ABC, abstractmethod


class Entity(ABC):
    def __init__(self, key: str):
        self.key = key

    def identity(self) -> str:
        return self.key

    @abstractmethod
    def kind(self) -> str:
        ...

    def describe(self) -> str:
        return self.kind() + ":" + self.identity()


class Timestamped(Entity):
    def __init__(self, key: str, created: str = "1970-01-01"):
        super().__init__(key)
        self.created = created

    def describe(self) -> str:
        # With self a Record, this super() lands on Auditable.describe.
        return "ts(" + self.created + ")|" + super().describe()


class Auditable(Entity):
    def __init__(self, key: str, actor: str = "system"):
        super().__init__(key)
        self.actor = actor

    def describe(self) -> str:
        return "by(" + self.actor + ")|" + super().describe()


class Record(Timestamped, Auditable):
    """MRO: Record, Timestamped, Auditable, Entity, ABC, object."""

    def __init__(self, key: str, created: str = "1970-01-01", actor: str = "system"):
        Timestamped.__init__(self, key, created)
        self.actor = actor

    def describe(self) -> str:
        return "rec|" + super().describe()

    @property
    def label(self) -> str:
        # A property getter: an attribute READ that is really a call.
        return self.describe().upper()
