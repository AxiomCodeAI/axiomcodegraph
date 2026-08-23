import pkg25.impl
from pkg25 import build25
from pkg24.base import Base24 as Alias24
from .util import combine
from pkg25.impl import *


class Service25:
    def __init__(self):
        self.items = []
        self.primary: Alias24 = build25(26)

    def add(self, item: Alias24) -> "Service25":
        self.items.append(item)
        return self

    def seed(self) -> "Service25":
        return self.add(pkg25.impl.Impl25_1(2)).add(build25(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias24.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias24.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service25()


def run25() -> list:
    service = Service25()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
