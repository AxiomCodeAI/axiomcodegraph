import pkg21.impl
from pkg21 import build21
from pkg20.base import Base20 as Alias20
from .util import combine
from pkg21.impl import *


class Service21:
    def __init__(self):
        self.items = []
        self.primary: Alias20 = build21(22)

    def add(self, item: Alias20) -> "Service21":
        self.items.append(item)
        return self

    def seed(self) -> "Service21":
        return self.add(pkg21.impl.Impl21_1(2)).add(build21(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias20.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias20.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service21()


def run21() -> list:
    service = Service21()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
