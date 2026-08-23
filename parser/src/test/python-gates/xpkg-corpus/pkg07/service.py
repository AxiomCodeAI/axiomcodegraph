import pkg07.impl
from pkg07 import build07
from pkg06.base import Base06 as Alias06
from .util import combine
from pkg07.impl import *


class Service07:
    def __init__(self):
        self.items = []
        self.primary: Alias06 = build07(8)

    def add(self, item: Alias06) -> "Service07":
        self.items.append(item)
        return self

    def seed(self) -> "Service07":
        return self.add(pkg07.impl.Impl07_1(2)).add(build07(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias06.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias06.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service07()


def run07() -> list:
    service = Service07()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
