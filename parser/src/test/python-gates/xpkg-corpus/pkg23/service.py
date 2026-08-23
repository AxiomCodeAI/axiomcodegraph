import pkg23.impl
from pkg23 import build23
from pkg22.base import Base22 as Alias22
from .util import combine
from pkg23.impl import *


class Service23:
    def __init__(self):
        self.items = []
        self.primary: Alias22 = build23(24)

    def add(self, item: Alias22) -> "Service23":
        self.items.append(item)
        return self

    def seed(self) -> "Service23":
        return self.add(pkg23.impl.Impl23_1(2)).add(build23(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias22.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias22.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service23()


def run23() -> list:
    service = Service23()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
