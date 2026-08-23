import pkg17.impl
from pkg17 import build17
from pkg16.base import Base16 as Alias16
from .util import combine
from pkg17.impl import *


class Service17:
    def __init__(self):
        self.items = []
        self.primary: Alias16 = build17(18)

    def add(self, item: Alias16) -> "Service17":
        self.items.append(item)
        return self

    def seed(self) -> "Service17":
        return self.add(pkg17.impl.Impl17_1(2)).add(build17(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias16.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias16.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service17()


def run17() -> list:
    service = Service17()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
