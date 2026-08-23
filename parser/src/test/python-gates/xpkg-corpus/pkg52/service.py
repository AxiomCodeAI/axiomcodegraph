import pkg52.impl
from pkg52 import build52
from pkg51.base import Base51 as Alias51
from .util import combine
from pkg52.impl import *


class Service52:
    def __init__(self):
        self.items = []
        self.primary: Alias51 = build52(53)

    def add(self, item: Alias51) -> "Service52":
        self.items.append(item)
        return self

    def seed(self) -> "Service52":
        return self.add(pkg52.impl.Impl52_1(2)).add(build52(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias51.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias51.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service52()


def run52() -> list:
    service = Service52()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
