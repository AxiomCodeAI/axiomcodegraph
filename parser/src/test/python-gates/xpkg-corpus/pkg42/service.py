import pkg42.impl
from pkg42 import build42
from pkg42.base import Base42 as Alias42
from .util import combine
from pkg42.impl import *


class Service42:
    def __init__(self):
        self.items = []
        self.primary: Alias42 = build42(43)

    def add(self, item: Alias42) -> "Service42":
        self.items.append(item)
        return self

    def seed(self) -> "Service42":
        return self.add(pkg42.impl.Impl42_1(2)).add(build42(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias42.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias42.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service42()


def run42() -> list:
    service = Service42()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
