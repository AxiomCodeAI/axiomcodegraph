import pkg48.impl
from pkg48 import build48
from pkg48.base import Base48 as Alias48
from .util import combine
from pkg48.impl import *


class Service48:
    def __init__(self):
        self.items = []
        self.primary: Alias48 = build48(49)

    def add(self, item: Alias48) -> "Service48":
        self.items.append(item)
        return self

    def seed(self) -> "Service48":
        return self.add(pkg48.impl.Impl48_1(2)).add(build48(3))

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


SINGLETON = Service48()


def run48() -> list:
    service = Service48()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
