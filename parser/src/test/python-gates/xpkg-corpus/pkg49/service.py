import pkg49.impl
from pkg49 import build49
from pkg48.base import Base48 as Alias48
from .util import combine
from pkg49.impl import *


class Service49:
    def __init__(self):
        self.items = []
        self.primary: Alias48 = build49(50)

    def add(self, item: Alias48) -> "Service49":
        self.items.append(item)
        return self

    def seed(self) -> "Service49":
        return self.add(pkg49.impl.Impl49_1(2)).add(build49(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias48.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias48.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service49()


def run49() -> list:
    service = Service49()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
