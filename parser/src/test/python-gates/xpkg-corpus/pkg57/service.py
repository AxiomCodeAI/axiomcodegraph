import pkg57.impl
from pkg57 import build57
from pkg56.base import Base56 as Alias56
from .util import combine
from pkg57.impl import *


class Service57:
    def __init__(self):
        self.items = []
        self.primary: Alias56 = build57(58)

    def add(self, item: Alias56) -> "Service57":
        self.items.append(item)
        return self

    def seed(self) -> "Service57":
        return self.add(pkg57.impl.Impl57_1(2)).add(build57(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias56.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias56.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service57()


def run57() -> list:
    service = Service57()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
