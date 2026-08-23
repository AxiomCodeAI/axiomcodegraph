import pkg22.impl
from pkg22 import build22
from pkg21.base import Base21 as Alias21
from .util import combine
from pkg22.impl import *


class Service22:
    def __init__(self):
        self.items = []
        self.primary: Alias21 = build22(23)

    def add(self, item: Alias21) -> "Service22":
        self.items.append(item)
        return self

    def seed(self) -> "Service22":
        return self.add(pkg22.impl.Impl22_1(2)).add(build22(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias21.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias21.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service22()


def run22() -> list:
    service = Service22()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
