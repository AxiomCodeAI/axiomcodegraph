import pkg27.impl
from pkg27 import build27
from pkg26.base import Base26 as Alias26
from .util import combine
from pkg27.impl import *


class Service27:
    def __init__(self):
        self.items = []
        self.primary: Alias26 = build27(28)

    def add(self, item: Alias26) -> "Service27":
        self.items.append(item)
        return self

    def seed(self) -> "Service27":
        return self.add(pkg27.impl.Impl27_1(2)).add(build27(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias26.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias26.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service27()


def run27() -> list:
    service = Service27()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
