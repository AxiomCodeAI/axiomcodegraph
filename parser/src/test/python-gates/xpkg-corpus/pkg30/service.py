import pkg30.impl
from pkg30 import build30
from pkg30.base import Base30 as Alias30
from .util import combine
from pkg30.impl import *


class Service30:
    def __init__(self):
        self.items = []
        self.primary: Alias30 = build30(31)

    def add(self, item: Alias30) -> "Service30":
        self.items.append(item)
        return self

    def seed(self) -> "Service30":
        return self.add(pkg30.impl.Impl30_1(2)).add(build30(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias30.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias30.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service30()


def run30() -> list:
    service = Service30()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
