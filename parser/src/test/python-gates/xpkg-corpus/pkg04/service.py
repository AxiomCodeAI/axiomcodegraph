import pkg04.impl
from pkg04 import build04
from pkg03.base import Base03 as Alias03
from .util import combine
from pkg04.impl import *


class Service04:
    def __init__(self):
        self.items = []
        self.primary: Alias03 = build04(5)

    def add(self, item: Alias03) -> "Service04":
        self.items.append(item)
        return self

    def seed(self) -> "Service04":
        return self.add(pkg04.impl.Impl04_1(2)).add(build04(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias03.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias03.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service04()


def run04() -> list:
    service = Service04()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
