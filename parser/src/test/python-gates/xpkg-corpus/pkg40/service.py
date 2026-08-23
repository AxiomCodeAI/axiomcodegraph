import pkg40.impl
from pkg40 import build40
from pkg39.base import Base39 as Alias39
from .util import combine
from pkg40.impl import *


class Service40:
    def __init__(self):
        self.items = []
        self.primary: Alias39 = build40(41)

    def add(self, item: Alias39) -> "Service40":
        self.items.append(item)
        return self

    def seed(self) -> "Service40":
        return self.add(pkg40.impl.Impl40_1(2)).add(build40(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias39.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias39.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service40()


def run40() -> list:
    service = Service40()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
