import pkg34.impl
from pkg34 import build34
from pkg33.base import Base33 as Alias33
from .util import combine
from pkg34.impl import *


class Service34:
    def __init__(self):
        self.items = []
        self.primary: Alias33 = build34(35)

    def add(self, item: Alias33) -> "Service34":
        self.items.append(item)
        return self

    def seed(self) -> "Service34":
        return self.add(pkg34.impl.Impl34_1(2)).add(build34(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias33.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias33.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service34()


def run34() -> list:
    service = Service34()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
