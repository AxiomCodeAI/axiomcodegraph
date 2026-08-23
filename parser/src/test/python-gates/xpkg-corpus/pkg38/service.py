import pkg38.impl
from pkg38 import build38
from pkg37.base import Base37 as Alias37
from .util import combine
from pkg38.impl import *


class Service38:
    def __init__(self):
        self.items = []
        self.primary: Alias37 = build38(39)

    def add(self, item: Alias37) -> "Service38":
        self.items.append(item)
        return self

    def seed(self) -> "Service38":
        return self.add(pkg38.impl.Impl38_1(2)).add(build38(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias37.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias37.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service38()


def run38() -> list:
    service = Service38()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
