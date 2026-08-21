"""Scratch input for return-type and attribute flow. Not a fixture."""
from typing import Optional, List


class Conn:
    def send(self, payload: bytes) -> int:
        return len(payload)


class Pool:
    def acquire(self) -> Conn:
        return Conn()

    def all(self) -> List[Conn]:
        return [Conn()]


def make_pool() -> Pool:
    return Pool()


def unannotated_pool():
    return Pool()


class Service:
    def __init__(self, pool: Pool, name: str) -> None:
        self.pool = pool
        self.direct = Conn()
        self.factory = make_pool()
        self.items = []
        self.label = name
        self.maybe: Optional[Conn] = None

    def _current(self) -> Conn:
        return self.direct

    def run(self) -> None:
        self.pool.acquire()
        self.direct.send(b"x")
        self.factory.acquire()
        self.items.append(1)
        self.label.upper()
        self.maybe.send(b"y")
        self._current().send(b"z")
        make_pool().acquire()
        Conn().send(b"w")
        unannotated_pool().acquire()
        self.pool.all().append(Conn())
