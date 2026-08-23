import pkg14.impl
from pkg14 import build14
from pkg13.base import Base13 as Alias13
from .util import combine
from pkg14.impl import *


class Service14:
    def __init__(self):
        self.items = []
        self.primary: Alias13 = build14(15)

    def add(self, item: Alias13) -> "Service14":
        self.items.append(item)
        return self

    def seed(self) -> "Service14":
        return self.add(pkg14.impl.Impl14_1(2)).add(build14(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias13.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias13.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service14()


def run14() -> list:
    service = Service14()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
