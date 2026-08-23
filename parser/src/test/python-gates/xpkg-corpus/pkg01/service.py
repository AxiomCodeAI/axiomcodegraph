import pkg01.impl
from pkg01 import build01
from pkg00.base import Base00 as Alias00
from .util import combine
from pkg01.impl import *


class Service01:
    def __init__(self):
        self.items = []
        self.primary: Alias00 = build01(2)

    def add(self, item: Alias00) -> "Service01":
        self.items.append(item)
        return self

    def seed(self) -> "Service01":
        return self.add(pkg01.impl.Impl01_1(2)).add(build01(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias00.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias00.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service01()


def run01() -> list:
    service = Service01()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
