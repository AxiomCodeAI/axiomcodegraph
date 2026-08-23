import pkg24.impl
from pkg24 import build24
from pkg24.base import Base24 as Alias24
from .util import combine
from pkg24.impl import *


class Service24:
    def __init__(self):
        self.items = []
        self.primary: Alias24 = build24(25)

    def add(self, item: Alias24) -> "Service24":
        self.items.append(item)
        return self

    def seed(self) -> "Service24":
        return self.add(pkg24.impl.Impl24_1(2)).add(build24(3))

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


SINGLETON = Service24()


def run24() -> list:
    service = Service24()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
