import pkg51.impl
from pkg51 import build51
from pkg50.base import Base50 as Alias50
from .util import combine
from pkg51.impl import *


class Service51:
    def __init__(self):
        self.items = []
        self.primary: Alias50 = build51(52)

    def add(self, item: Alias50) -> "Service51":
        self.items.append(item)
        return self

    def seed(self) -> "Service51":
        return self.add(pkg51.impl.Impl51_1(2)).add(build51(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias50.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias50.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service51()


def run51() -> list:
    service = Service51()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
