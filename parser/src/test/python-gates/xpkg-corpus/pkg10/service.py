import pkg10.impl
from pkg10 import build10
from pkg09.base import Base09 as Alias09
from .util import combine
from pkg10.impl import *


class Service10:
    def __init__(self):
        self.items = []
        self.primary: Alias09 = build10(11)

    def add(self, item: Alias09) -> "Service10":
        self.items.append(item)
        return self

    def seed(self) -> "Service10":
        return self.add(pkg10.impl.Impl10_1(2)).add(build10(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias09.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias09.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service10()


def run10() -> list:
    service = Service10()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
