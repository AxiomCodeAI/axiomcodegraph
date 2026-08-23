import pkg11.impl
from pkg11 import build11
from pkg10.base import Base10 as Alias10
from .util import combine
from pkg11.impl import *


class Service11:
    def __init__(self):
        self.items = []
        self.primary: Alias10 = build11(12)

    def add(self, item: Alias10) -> "Service11":
        self.items.append(item)
        return self

    def seed(self) -> "Service11":
        return self.add(pkg11.impl.Impl11_1(2)).add(build11(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias10.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias10.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service11()


def run11() -> list:
    service = Service11()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
