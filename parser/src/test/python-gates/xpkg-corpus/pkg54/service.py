import pkg54.impl
from pkg54 import build54
from pkg54.base import Base54 as Alias54
from .util import combine
from pkg54.impl import *


class Service54:
    def __init__(self):
        self.items = []
        self.primary: Alias54 = build54(55)

    def add(self, item: Alias54) -> "Service54":
        self.items.append(item)
        return self

    def seed(self) -> "Service54":
        return self.add(pkg54.impl.Impl54_1(2)).add(build54(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias54.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias54.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service54()


def run54() -> list:
    service = Service54()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
