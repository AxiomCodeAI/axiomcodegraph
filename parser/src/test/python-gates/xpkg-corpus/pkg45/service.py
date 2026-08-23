import pkg45.impl
from pkg45 import build45
from pkg44.base import Base44 as Alias44
from .util import combine
from pkg45.impl import *


class Service45:
    def __init__(self):
        self.items = []
        self.primary: Alias44 = build45(46)

    def add(self, item: Alias44) -> "Service45":
        self.items.append(item)
        return self

    def seed(self) -> "Service45":
        return self.add(pkg45.impl.Impl45_1(2)).add(build45(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias44.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias44.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service45()


def run45() -> list:
    service = Service45()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
