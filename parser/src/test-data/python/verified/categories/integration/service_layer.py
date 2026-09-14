"""A small layered application — the shapes an engine must chain through."""
import dataclasses
import typing


@dataclasses.dataclass
class Record:
    key: str
    amount: int

    def scaled(self, factor: int) -> int:
        return self.amount * factor


class Store:
    def __init__(self) -> None:
        self.rows: typing.List[Record] = []

    def add(self, record: Record) -> None:
        self.rows.append(record)

    def total(self) -> int:
        return sum(r.amount for r in self.rows)


class Repository:
    def __init__(self, store: Store) -> None:
        self.store = store

    def accept(self, record: Record) -> None:
        self.store.add(record)

    def record(self, key: str, amount: int) -> Record:
        row = Record(key, amount)
        self.store.add(row)
        return row

    def total(self) -> int:
        return self.store.total()


class Service:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository

    def deposit(self, key: str, amount: int) -> int:
        # Constructed locally rather than taken from record()'s return, so the
        # receiver has a stated type. Return-type flow is a real gap, tracked by
        # engine-feasibility-gate; a tripwire corpus should not depend on it.
        row = Record(key, amount)
        # Through the repository's own API rather than self.repository.store.add:
        # a two-hop attribute chain needs the engine to type an intermediate, which
        # engine-feasibility-gate tracks and a tripwire must not depend on.
        self.repository.accept(row)
        return row.scaled(2)

    def summary(self) -> int:
        return self.repository.total()


def build() -> Service:
    return Service(Repository(Store()))


def exercise() -> int:
    service = build()
    service.deposit("a", 1)
    return service.summary()
